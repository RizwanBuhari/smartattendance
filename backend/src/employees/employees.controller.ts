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
  Req,
  UseGuards,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { AdminGuard } from '../auth/admin.guard';
import { EmployeeGuard } from '../auth/employee.guard';
import type { AuthedEmployee } from '../auth/employee.guard';
import type { Employee, SelfProfileChanges } from './employees.service';

interface AuthedRequest {
  employee: AuthedEmployee;
}

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // Dashboard only — the full staff list is personal data.
  @UseGuards(AdminGuard)
  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @UseGuards(AdminGuard)
  @Post()
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
  findMe(@Req() req: AuthedRequest) {
    // The guard already fetched and validated this record — returning it here
    // costs nothing, where findByAuthUid() would repeat the same query.
    return req.employee;
  }

  @UseGuards(EmployeeGuard)
  @Patch('me')
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
  update(@Param('id') id: string, @Body() changes: Partial<Employee>) {
    return this.employeesService.update(id, changes);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }

  @UseGuards(AdminGuard)
  @Post('seed')
  seed() {
    return this.employeesService.seed();
  }
}
