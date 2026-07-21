// Routes for the company_codes collection.
//   GET  /company-codes          -> list all codes (dashboard)
//   POST /company-codes          -> admin issues a code for an employee
//   GET  /company-codes/check/:code -> mobile app verifies a code; a valid code
//                                      is marked used right away (single-use)
//   POST /company-codes/redeem   -> idempotent confirm at final registration
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CompanyCodesService } from './company-codes.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller('company-codes')
export class CompanyCodesController {
  constructor(private readonly companyCodesService: CompanyCodesService) {}

  @UseGuards(AdminGuard)
  @Get()
  findAll() {
    return this.companyCodesService.findAll();
  }

  // employeeId is optional — omit it to issue a standalone code for a new user.
  // Admin-only: issuing codes is how someone joins the company.
  @UseGuards(AdminGuard)
  @Post()
  create(@Body('employeeId') employeeId?: string) {
    return this.companyCodesService.create(employeeId);
  }

  // Mobile app previews a code as the user enters it, so the form can pre-fill
  // the name/email the admin registered. READ-ONLY: the code is not consumed
  // here, and a caller that skips this step entirely gains nothing — POST
  // /auth/register validates and consumes the code itself.
  //
  // Unauthenticated by necessity: the person entering it has no account yet.
  @Get('check/:code')
  check(@Param('code') code: string) {
    return this.companyCodesService.peek(code);
  }

  // POST /company-codes/redeem is GONE. Registration now redeems the code
  // server-side inside AuthService.register(), so exposing it as a public route
  // only gave an anonymous caller a way to burn other people's invite codes.
  // CompanyCodesService.redeem() is unchanged and still called from there.

  // Admin re-enables a used code so it can be entered again (e.g. the employee
  // entered it but never finished registering).
  @UseGuards(AdminGuard)
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.companyCodesService.reactivate(id);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.companyCodesService.remove(id);
  }
}
