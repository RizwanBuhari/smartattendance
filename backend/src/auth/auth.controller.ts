// The mobile app's sign-in surface. Every one of these routes is deliberately
// UNGUARDED — they are what a user calls before they have a token, so requiring
// one would be circular. AuthService does the checking instead.
//
//   POST /auth/login           -> email + password  -> custom token + session
//   POST /auth/register        -> creates the Firebase account AND the employee
//                                 record, then signs the user in
//   POST /auth/password-reset  -> emails a reset link (always reports success)
import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  PasswordResetDto,
  AuthResultDto,
} from './dto/auth.dto';
import type { LoginRequest, RegisterRequest } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Verifies the credentials via Firebase Identity Toolkit (the Admin SDK ' +
      'cannot check passwords itself) and mints a fresh session id.\n\n' +
      '**Claiming the session is part of signing in**, not a separate call the ' +
      'device could skip or fail — which is what makes device eviction real. ' +
      'Any other device signed in as this account is already logged out by the ' +
      'time this returns.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiResponse({ status: 401, description: 'Wrong credentials.' })
  @ApiResponse({ status: 403, description: 'The employee account is disabled.' })
  login(@Body() body: LoginRequest) {
    return this.authService.login(body);
  }

  @Post('register')
  @ApiOperation({
    summary: 'Register with a company code',
    description:
      'Creates the Firebase account and attaches it to the employee record ' +
      'named by the single-use code, then signs the user in — one call, so a ' +
      'half-registered account is not left behind if the app closes.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiResponse({
    status: 400,
    description: 'The code is unknown, already used, or the email is taken.',
  })
  register(@Body() body: RegisterRequest) {
    return this.authService.register(body);
  }

  @Post('password-reset')
  @ApiOperation({
    summary: 'Send a password reset email',
    description:
      'Always reports success, whether or not the address exists — otherwise ' +
      'the response would confirm which emails have accounts.',
  })
  @ApiBody({ type: PasswordResetDto })
  @ApiResponse({ status: 201, description: 'Always succeeds by design.' })
  passwordReset(@Body('email') email: string) {
    return this.authService.sendPasswordReset(email);
  }
}
