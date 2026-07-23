// The backend is now the front door for signing in and signing up.
//
// Why this exists: the mobile app used to call Firebase Auth directly from the
// device, which meant the server never saw a sign-in and could not enforce
// anything at that moment — whether the account maps to a real employee,
// whether that employee is still active, or which device owns the session. All
// of that had to be re-checked later, on every request, by EmployeeGuard.
//
// Now the app posts credentials here instead. This service:
//   1. verifies the password with Firebase,
//   2. applies our own rules (employee exists, employee is active),
//   3. claims the single active session for this device,
//   4. hands back a CUSTOM TOKEN.
//
// Step 4 is what keeps the rest of the app working unchanged. The device calls
// signInWithCustomToken() with it, which gives the Firebase SDK a normal signed
// -in session — so ID tokens, token refresh, and the existing realtime
// Firestore streams all behave exactly as before. The only thing that changed
// is who decides the sign-in is allowed.
//
// Note on passwords: the Admin SDK deliberately cannot verify a password, so
// step 1 uses Firebase's Identity Toolkit REST endpoint, which needs the
// project's Web API key (FIREBASE_API_KEY in backend/.env). The password is
// forwarded to Google and never stored or logged here.
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { CompanyCodesService } from '../company-codes/company-codes.service';
import { EmployeesService } from '../employees/employees.service';
import { MailService } from '../mail/mail.service';
import type { Employee } from '../employees/employees.service';
import { APPROVER_ROLES } from '../employees/employees.service';

export interface LoginRequest {
  email: string;
  password: string;
}

// The registration form's fields, plus the company code.
//
// There is deliberately no employeeId here. Which employee record the new login
// attaches to is read from the code document server-side — accepting it from
// the client is what made this an account-takeover path.
export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  nationality: string;
  code: string;
}

export interface AuthResult {
  // Exchanged on the device via FirebaseAuth.signInWithCustomToken().
  customToken: string;
  // The device stores this and watches employee_Sessions for it changing.
  sessionId: string;
  employee: Employee & { id: string };
}

// The subset of Identity Toolkit's error codes worth translating. Anything else
// falls through to a generic message rather than leaking Google's wording.
const SIGN_IN_ERRORS: Record<string, string> = {
  EMAIL_NOT_FOUND: 'No account found for that email.',
  INVALID_PASSWORD: 'Incorrect password.',
  INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
  INVALID_EMAIL: 'Please enter a valid email address.',
  USER_DISABLED: 'Your account is disabled. Contact your administrator.',
  TOO_MANY_ATTEMPTS_TRY_LATER:
    'Too many login attempts. Please try again later.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly apiKey = process.env.FIREBASE_API_KEY ?? '';
  private readonly employees = getFirestore().collection('employees_ids');
  private readonly sessions = getFirestore().collection('employee_Sessions');

  constructor(
    private readonly employeesService: EmployeesService,
    private readonly companyCodesService: CompanyCodesService,
    private readonly mailService: MailService,
  ) {
    if (!this.apiKey) {
      this.logger.warn(
        'FIREBASE_API_KEY is not set — POST /auth/login cannot verify passwords. ' +
          'Add it to backend/.env (Firebase console → Project settings → Web API key).',
      );
    }
  }

  // --- Sign in --------------------------------------------------------------

  async login({ email, password }: LoginRequest): Promise<AuthResult> {
    const cleanEmail = (email ?? '').trim();
    if (!cleanEmail || !password) {
      throw new BadRequestException('Email and password are required.');
    }

    const uid = await this.verifyPassword(cleanEmail, password);
    const employee = await this.requireActiveEmployee(uid);
    return this.startSession(uid, employee);
  }

  // --- Sign up --------------------------------------------------------------

  // Creates the Firebase account AND the employee record together, then signs
  // the user in — so the app can no longer end up with a login that has no
  // employee behind it (which is what happened when the device did these as
  // three independent calls and ignored the failures).
  //
  // The invite code is validated and consumed HERE, first, and the employee it
  // was issued for comes from the code document. Both matter:
  //
  //   • Registration used to consume the code on an earlier screen and then
  //     call redeem() without reading its result, so an invalid code still
  //     produced a working account. The invite system was decorative.
  //   • The employee to link to used to arrive in the request body, so a caller
  //     could attach their new login to any existing employee — including a
  //     siteAdmin — and inherit that person's access.
  //
  // Neither is reachable now: nothing the client sends decides who they become.
  async register(request: RegisterRequest): Promise<AuthResult> {
    const email = (request.email ?? '').trim();
    const { password, name, nationality, code } = request;

    if (!email || !password || !name?.trim() || !code) {
      throw new BadRequestException(
        'Email, password, name and company code are required.',
      );
    }

    // Atomic: validates and burns the code in one transaction, so the same code
    // cannot be raced through twice. Nothing has been created yet, so a bad
    // code costs nothing to reject.
    const consumed = await this.companyCodesService.consume(code);
    if (!consumed.ok) {
      throw new BadRequestException(consumed.message);
    }

    let uid: string | null = null;
    try {
      // The Admin SDK creates the account, so the device never talks to
      // Firebase Auth itself.
      uid = (await getAuth().createUser({ email, password })).uid;

      const employee = (await this.employeesService.registerSelf({
        authUid: uid,
        name: name.trim(),
        email,
        nationality: (nationality ?? '').trim(),
        // From the code, never from the request.
        employeeId: consumed.employeeId ?? undefined,
      })) as Employee & { id: string };

      return await this.startSession(uid, employee);
    } catch (err) {
      // Undo everything, in reverse. Leaving the code burned would cost the
      // user their invite for a failure that was not theirs.
      if (uid) {
        await getAuth()
          .deleteUser(uid)
          .catch(() => {
            // Best effort — an orphan account is recoverable from the console,
            // but reporting the original failure matters more.
          });
      }
      await this.companyCodesService.release(code).catch(() => {});

      // Messages meant for the user (bad email, already-claimed employee,
      // duplicate account) must survive the rollback rather than being
      // flattened into "something went wrong".
      throw this.registrationError(err, email);
    }
  }

  // Translates a registration failure into something the user can act on.
  private registrationError(err: unknown, email: string) {
    if (err instanceof HttpException) return err;

    const code = (err as { code?: string }).code ?? '';
    if (code === 'auth/email-already-exists') {
      return new BadRequestException(
        'An account already exists for that email. Try signing in instead.',
      );
    }
    if (code === 'auth/invalid-password') {
      return new BadRequestException('Password must be at least 6 characters.');
    }
    if (code === 'auth/invalid-email') {
      return new BadRequestException('Please enter a valid email address.');
    }

    this.logger.error(`Registration rolled back for ${email}: ${String(err)}`);
    return new InternalServerErrorException(
      'Could not complete registration. Please try again.',
    );
  }

  // --- Password reset -------------------------------------------------------

  // Always reports success. Telling an anonymous caller whether an address is
  // registered would turn this into an account-enumeration oracle.
  async sendPasswordReset(email: string): Promise<{ ok: true }> {
    const cleanEmail = (email ?? '').trim();
    if (!cleanEmail) {
      throw new BadRequestException('Email is required.');
    }

    try {
      const link = await getAuth().generatePasswordResetLink(cleanEmail);
      await this.mailService.sendPasswordReset({ to: cleanEmail, link });
    } catch (err) {
      this.logger.warn(
        `Password reset not sent for ${cleanEmail}: ${String(err)}`,
      );
    }
    return { ok: true };
  }

  // --- Internals ------------------------------------------------------------

  // Checks the password with Firebase and returns the uid. This is the one
  // thing the Admin SDK cannot do, hence the REST call.
  private async verifyPassword(email: string, password: string) {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'Sign-in is not configured on the server.',
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      );
    } catch (err) {
      this.logger.error(`Identity Toolkit unreachable: ${String(err)}`);
      throw new InternalServerErrorException(
        'Could not reach the sign-in service. Please try again.',
      );
    }

    const body = (await response.json()) as {
      localId?: string;
      error?: { message?: string };
    };

    if (!response.ok || !body.localId) {
      // Codes arrive as "INVALID_PASSWORD" or "TOO_MANY_ATTEMPTS_TRY_LATER : ..."
      const raw = body.error?.message ?? '';
      const key = raw.split(':')[0].trim();
      throw new UnauthorizedException(
        SIGN_IN_ERRORS[key] ?? 'Incorrect email or password.',
      );
    }

    return body.localId;
  }

  // A Firebase account is not enough — it has to map to an employee record that
  // is still active. EmployeeGuard repeats this on every later request; doing it
  // here means a disabled employee is stopped at the door with a clear message
  // instead of signing in and hitting failures inside the app.
  private async requireActiveEmployee(uid: string) {
    const snap = await this.employees
      .where('authUid', '==', uid)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new ForbiddenException(
        'No employee record is linked to this account. Contact your administrator.',
      );
    }

    const doc = snap.docs[0];
    const employee = { ...(doc.data() as Employee), id: doc.id };
    if (employee.status !== 'active') {
      throw new ForbiddenException('This account has been disabled.');
    }
    return employee;
  }

  // Makes THIS device the one and only device signed in as this account, and
  // returns everything it needs to take over.
  //
  // "One account, one device" is enforced in three layers, because any one of
  // them alone leaves a hole:
  //
  //   1. A new session id replaces the stored one. Other devices are watching
  //      that document, so they notice within a second and sign themselves out.
  //      This is the fast, visible eviction — but it is cooperative, so it only
  //      covers a device that is running, online, and honest.
  //
  //   2. EmployeeGuard rejects any API call whose X-Session-Id is not the
  //      current one. That is not cooperative: an evicted device cannot guess
  //      the new id, so it is locked out of the API immediately even if it
  //      ignores step 1 or is a modified client.
  //
  //   3. revokeRefreshTokens() invalidates every token Firebase previously
  //      issued to this account. This is what stops the evicted device reading
  //      Firestore DIRECTLY, which steps 1 and 2 cannot touch — those streams
  //      never go through our backend. Once its ID token expires (≤1h) the SDK
  //      cannot mint another, so it drops to signed-out on its own.
  //
  // Order matters: the session document is written FIRST so the old device's
  // listener can fire while it still has read access, and the revoke happens
  // BEFORE the custom token is minted so the new sign-in lands after the
  // revocation cut-off and is not caught by it.
  private async startSession(
    uid: string,
    employee: Employee & { id: string },
  ): Promise<AuthResult> {
    const sessionId = randomUUID();
    await this.sessions.doc(employee.id).set({
      sessionId,
      employeeId: employee.id,
      name: employee.name,
      updatedAt: new Date().toISOString(),
    });

    await getAuth().revokeRefreshTokens(uid);

    // Durable custom claims — Firebase copies these into every ID token minted
    // from here on, including inside Firestore security rules as
    // request.auth.token.siteAdmin. Set before the custom token is created so
    // the very first token of this session already carries them.
    // The claim means "may run the gate screen", not "has the siteAdmin role" —
    // firestore.rules reads it as isSiteAdmin() to allow the code_Requests and
    // team-attendance listeners behind that screen. A site_supervisor is alerted
    // by CodeRequestsService and may call /otp/issue, so stamping this only for
    // 'siteAdmin' left supervisors with a visible screen whose live queries were
    // all denied. Kept in step with APPROVER_ROLES rather than re-listing roles.
    await getAuth().setCustomUserClaims(uid, {
      siteAdmin: !!employee.role && APPROVER_ROLES.includes(employee.role),
      employeeId: employee.id,
    });

    return {
      customToken: await getAuth().createCustomToken(uid),
      sessionId,
      employee,
    };
  }
}
