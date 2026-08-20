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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CompanyCodesService } from './company-codes.service';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Company Codes')
@ApiBearerAuth('firebase')
@Controller('company-codes')
export class CompanyCodesController {
  constructor(private readonly companyCodesService: CompanyCodesService) {}

  @UseGuards(AdminGuard)
  @Get()
  @ApiOperation({
    summary: 'List company codes',
    description:
      'Backs the invite-status column on the dashboard employee list: a code ' +
      'that exists but is unused reads as "pending", a used one as "joined".',
  })
  @ApiResponse({ status: 200, description: 'All codes with their state.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  findAll() {
    return this.companyCodesService.findAll();
  }

  // employeeId is optional — omit it to issue a standalone code for a new user.
  // Admin-only: issuing codes is how someone joins the company.
  @UseGuards(AdminGuard)
  @Post()
  @ApiOperation({
    summary: 'Issue a single-use registration code',
    description:
      'Admin-only: issuing codes is how someone joins the company. Pass ' +
      '`employeeId` to bind the code to a record the admin already created, or ' +
      'omit it for a standalone code that creates a fresh employee on ' +
      'registration.',
  })
  @ApiResponse({ status: 201, description: 'The issued code.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
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
  @ApiOperation({
    summary: 'Preview a code during registration (unauthenticated)',
    description:
      'Lets the mobile form pre-fill the name and email the admin registered.\n\n' +
      '**Read-only** — the code is not consumed here, and a caller who skips ' +
      'this step gains nothing, because `POST /auth/register` validates and ' +
      'consumes the code itself.\n\n' +
      'Unauthenticated by necessity: the person entering the code has no ' +
      'account yet.',
  })
  @ApiParam({ name: 'code', description: 'The code as typed.', example: 'K7M2P9QX' })
  @ApiResponse({ status: 200, description: 'Validity, and any pre-fill details.' })
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
  @ApiOperation({
    summary: 'Re-enable a used code',
    description:
      'For the common case where an employee entered their code but never ' +
      'finished registering, so it burned without producing an account.',
  })
  @ApiParam({ name: 'id', description: 'Code document id.' })
  @ApiResponse({ status: 201, description: 'Code is usable again.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  reactivate(@Param('id') id: string) {
    return this.companyCodesService.reactivate(id);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a company code' })
  @ApiParam({ name: 'id', description: 'Code document id.' })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  remove(@Param('id') id: string) {
    return this.companyCodesService.remove(id);
  }
}
