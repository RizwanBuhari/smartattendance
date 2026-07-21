// The mobile app's sign-in surface. Every one of these routes is deliberately
// UNGUARDED — they are what a user calls before they have a token, so requiring
// one would be circular. AuthService does the checking instead.
//
//   POST /auth/login           -> email + password  -> custom token + session
//   POST /auth/register        -> creates the Firebase account AND the employee
//                                 record, then signs the user in
//   POST /auth/password-reset  -> emails a reset link (always reports success)
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { LoginRequest, RegisterRequest } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginRequest) {
    return this.authService.login(body);
  }

  @Post('register')
  register(@Body() body: RegisterRequest) {
    return this.authService.register(body);
  }

  @Post('password-reset')
  passwordReset(@Body('email') email: string) {
    return this.authService.sendPasswordReset(email);
  }
}
