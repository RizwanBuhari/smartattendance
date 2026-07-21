// Bundles the sign-in / sign-up routes.
//
// It borrows the services that already own each piece of the work rather than
// reimplementing them: EmployeesService writes the employee record,
// CompanyCodesService redeems the invite code, MailService sends the password
// reset link.
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmployeesModule } from '../employees/employees.module';
import { CompanyCodesModule } from '../company-codes/company-codes.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [EmployeesModule, CompanyCodesModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
