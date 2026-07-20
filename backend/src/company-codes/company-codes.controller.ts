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

  // Mobile app verifies a code as the user enters it. A valid code is CONSUMED
  // here (marked used immediately). Returns { ok, employeeId, employeeName?,
  // employeeEmail? } so the app can pre-fill the registration form.
  @Get('check/:code')
  check(@Param('code') code: string) {
    return this.companyCodesService.check(code);
  }

  @Post('redeem')
  redeem(@Body('code') code: string) {
    return this.companyCodesService.redeem(code);
  }

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
