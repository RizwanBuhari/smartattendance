// Routes for the company_codes collection.
//   GET  /company-codes          -> list all codes (dashboard)
//   POST /company-codes          -> admin issues a code for an employee
//   POST /company-codes/redeem   -> mobile app redeems a code before registering
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CompanyCodesService } from './company-codes.service';

@Controller('company-codes')
export class CompanyCodesController {
  constructor(private readonly companyCodesService: CompanyCodesService) {}

  @Get()
  findAll() {
    return this.companyCodesService.findAll();
  }

  // Mobile app validates a code (read-only, does not consume it).
  // 200 { valid: true, employeeId } if valid & unused; 404 otherwise.
  @Get('check/:code')
  async check(@Param('code') code: string) {
    const result = await this.companyCodesService.check(code);
    if (!result) {
      throw new NotFoundException('Invalid or already-used code.');
    }
    return { valid: true, ...result };
  }

  // employeeId is optional — omit it to issue a standalone code for a new user.
  @Post()
  create(@Body('employeeId') employeeId?: string) {
    return this.companyCodesService.create(employeeId);
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
