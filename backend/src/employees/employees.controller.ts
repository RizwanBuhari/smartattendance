// Maps HTTP requests to the EmployeesService.
//
// Routes (all under /employees):
//   GET   /employees            -> list all employees (admin dashboard)
//   POST  /employees            -> create one (body = employee fields)
//   GET   /employees/me         -> the calling employee's own record (from token)
//   PATCH /employees/me         -> the calling employee edits their own profile
//   POST  /employees/seed       -> one-time: insert sample employees
//
// Note: /me is declared before the /:id routes below — NestJS matches routes in
// declaration order, so ":id" would otherwise swallow "me" as if it were a
// literal id.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { Employee, SelfProfileChanges } from './employees.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@ApiTags('Employees')
@ApiBearerAuth('firebase')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // Dashboard only — the full staff list is personal data.
  //   ?scope=staff        -> office + site employees (excludes supervisors/admins)
  //   ?scope=supervisors  -> site supervisors only
  //   (omitted)           -> everyone
  @UseGuards(AdminGuard)
  @Get()
  @ApiOperation({
    summary: 'List employees (admin)',
    description: 'The full staff list is personal data, so this is admin-only.',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['staff', 'supervisors'],
    description:
      '`staff` for office + site employees (excluding supervisors and admins), ' +
      '`supervisors` for site supervisors only. Omit for everyone.',
  })
  @ApiResponse({ status: 200, description: 'Employee records.' })
  @ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
  findAll(@Query('scope') scope?: 'staff' | 'supervisors') {
    return this.employeesService.findAll(scope);
  }

  @UseGuards(AdminGuard)
  @Post()
  @ApiOperation({
    summary: 'Create an employee (admin)',
    description:
      'Creates the record only — no login. The employee gets one by registering ' +
      'with a company code, which attaches their Firebase account to this ' +
      'record. Assign `assignedLocationIds` here to scope which geofences apply ' +
      'to them; leaving it empty means any approved location counts.',
  })
  @ApiResponse({ status: 201, description: 'Created.' })
  create(@Body() employee: Employee) {
    return this.employeesService.create(employee);
  }

  // --- Mobile app routes. ---------------------------------------------------
  // These used to take `?authUid=` and trust it, which meant anyone could read
  // or edit anyone else's profile by changing one query parameter. The uid now
  // comes from the verified Firebase token via EmployeeGuard, so there is
  // nothing left for a caller to claim.
  @UseGuards(EmployeeGuard)
  @Get('me')
  @ApiSecurity('session')
  @ApiOperation({
    summary: "The caller's own employee record",
    description:
      'Includes their assigned locations, which the mobile app uses to register ' +
      'native geofences.\n\n' +
      'This used to take `?authUid=` and trust it, so anyone could read anyone ' +
      "else's profile by editing one query parameter. The uid now comes from " +
      'the verified token — there is nothing left for a caller to claim.',
  })
  @ApiResponse({ status: 200, description: "The caller's record." })
  findMe(@Req() req: AuthedRequest) {
    // The guard already fetched and validated this record — returning it here
    // costs nothing, where findByAuthUid() would repeat the same query.
    return req.employee;
  }

  @UseGuards(EmployeeGuard)
  @Patch('me')
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Edit your own profile',
    description:
      'Restricted to genuinely personal fields. Role, status and ' +
      '`assignedLocationIds` are not editable here — an employee widening their ' +
      'own approved locations would defeat the geofence.',
  })
  @ApiResponse({ status: 200, description: 'Updated.' })
  updateMe(@Req() req: AuthedRequest, @Body() changes: SelfProfileChanges) {
    return this.employeesService.updateSelf(req.employee.authUid, changes);
  }

  // POST /employees/register is GONE. It let an unauthenticated caller pass any
  // authUid and have it written onto any employee record — enough to attach
  // your own login to someone else's employee. Registration now happens inside
  // POST /auth/register, which creates the Firebase account itself and calls
  // EmployeesService.registerSelf() directly, so no public route is needed.

  // --- Dashboard only again. ------------------------------------------------
  @UseGuards(AdminGuard)
  @Patch(':id')
  @ApiOperation({
    summary: 'Update an employee (admin)',
    description:
      'Where an admin assigns approved locations, changes a role, or sets ' +
      '`status` to `disabled` to revoke access without deleting the history.',
  })
  @ApiParam({ name: 'id', description: 'Employee document id.' })
  @ApiResponse({ status: 200, description: 'Updated.' })
  update(@Param('id') id: string, @Body() changes: Partial<Employee>) {
    return this.employeesService.update(id, changes);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete an employee (admin)',
    description:
      'Permanent, and it takes their invite codes with it. Their attendance ' +
      'records become orphans and are purged on the next dashboard read. Prefer ' +
      "setting `status: 'disabled'` if the history matters.",
  })
  @ApiParam({ name: 'id', description: 'Employee document id.' })
  @ApiResponse({ status: 200, description: 'Deleted.' })
  remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }

  @UseGuards(AdminGuard)
  @Post('seed')
  @ApiOperation({
    summary: 'Insert sample employees (development)',
    description: 'One-time convenience for a fresh environment.',
  })
  @ApiResponse({ status: 201, description: 'Sample records inserted.' })
  seed() {
    return this.employeesService.seed();
  }
}
