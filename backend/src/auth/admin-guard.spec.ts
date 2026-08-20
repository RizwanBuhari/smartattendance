// Requirement #4 — access control on the admin surface.
//
// AdminGuard is what stands between the internet and every admin-only route
// (employee management, attendance review, etc.). These tests prove it rejects
// missing/non-admin tokens and only lets a verified admin through, attaching the
// verified email (so handlers never trust a client-supplied identity).
// AdminGuard pulls in AdminsService, which imports the real firebase-admin SDK
// at load time. We inject a fake AdminsService, so stub the SDK modules to keep
// the import graph from initialising Firebase.
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({}) }),
  FieldValue: {},
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

// Minimal ExecutionContext returning a fake HTTP request.
function contextWith(headers: Record<string, string | undefined>) {
  const request: { headers: typeof headers; adminEmail?: string } = { headers };
  return {
    ctx: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
    request,
  };
}

describe('AdminGuard', () => {
  it('rejects a request with no bearer token', async () => {
    const guard = new AdminGuard({
      verify: async () => ({ isAdmin: false }),
    } as any);
    const { ctx } = contextWith({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a valid token that is not an admin', async () => {
    const guard = new AdminGuard({
      verify: async () => ({ isAdmin: false, email: 'nobody@example.com' }),
    } as any);
    const { ctx } = contextWith({ authorization: 'Bearer sometoken' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admits a verified admin and attaches the verified email', async () => {
    const guard = new AdminGuard({
      verify: async (token: string) => {
        expect(token).toBe('good-token'); // token was extracted from the header
        return { isAdmin: true, email: 'admin@example.com' };
      },
    } as any);
    const { ctx, request } = contextWith({
      authorization: 'Bearer good-token',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // Handlers read this, never a body/query value.
    expect(request.adminEmail).toBe('admin@example.com');
  });
});
