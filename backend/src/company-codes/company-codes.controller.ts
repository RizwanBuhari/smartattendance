// Routes for the company_codes collection.
//   GET  /company-codes          -> list all codes (dashboard)
//   POST /company-codes          -> admin issues a code for an employee
//   GET  /company-codes/check/:code -> mobile app checks a code without consuming it
//   POST /company-codes/redeem   -> mobile app redeems a code before registering
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CompanyCodesService } from './company-codes.service';

@Controller('company-codes')
export class CompanyCodesController {
  constructor(private readonly companyCodesService: CompanyCodesService) {}

  @Get()
  findAll() {
    return this.companyCodesService.findAll();
  }

  // employeeId is optional — omit it to issue a standalone code for a new user.
  @Post()
  create(@Body('employeeId') employeeId?: string) {
    return this.companyCodesService.create(employeeId);
  }

  @Get('check/:code')
  check(@Param('code') code: string) {
    return this.companyCodesService.check(code);
  }

  @Post('redeem')
  redeem(@Body('code') code: string) {
    return this.companyCodesService.redeem(code);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.companyCodesService.remove(id);
  }
}
