// Swagger schemas for the unguarded sign-in routes.
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'eddie@elsewedy.com', format: 'email' })
  email: string;

  @ApiProperty({ example: 'correct-horse-battery', format: 'password' })
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'eddie@elsewedy.com', format: 'email' })
  email: string;

  @ApiProperty({ example: 'correct-horse-battery', format: 'password' })
  password: string;

  @ApiProperty({ example: 'Eddie Employee' })
  name: string;

  @ApiProperty({ example: 'Egyptian' })
  nationality: string;

  @ApiProperty({
    example: 'K7M2P9QX',
    description:
      'Single-use company code issued by an administrator. Which employee ' +
      'record the new login attaches to is read from this code server-side — ' +
      'there is deliberately no `employeeId` field, because accepting one from ' +
      'the client was an account-takeover path.',
  })
  code: string;
}

export class PasswordResetDto {
  @ApiProperty({ example: 'eddie@elsewedy.com', format: 'email' })
  email: string;
}

export class AuthResultDto {
  @ApiProperty({
    description:
      'Exchanged on the device via `FirebaseAuth.signInWithCustomToken()`.',
  })
  customToken: string;

  @ApiProperty({
    description:
      'Server-minted session id. The device stores this, sends it as ' +
      '`X-Session-Id` on every request, and watches `employee_Sessions` for it ' +
      'changing. Signing in elsewhere mints a new one, which evicts this ' +
      'device — that is how one-account-one-device is enforced without relying ' +
      'on the client to cooperate.',
  })
  sessionId: string;

  @ApiProperty({ description: "The employee's record, including their id." })
  employee: Record<string, unknown>;
}
