// Maps HTTP requests to the EmployeesService.
//
// Routes (all under /employees):
//   GET   /employees            -> list all employees (admin dashboard)
//   POST  /employees            -> create one (body = employee fields)
//   GET   /employees/me         -> the calling employee's own record (?authUid=)
//   PATCH /employees/me         -> the calling employee edits their own profile
//   POST  /employees/register   -> mobile app links/creates its own record post-signup
//   POST  /employees/seed       -> one-time: insert sample employees
//
// Note: /me and /register are declared before the /:id routes below — NestJS
// matches routes in declaration order, so ":id" would otherwise swallow
// "me" as if it were a literal id.
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
import { EmployeesService } from './employees.service';
import { AdminGuard } from '../auth/admin.guard';
import type { Employee, RegisterSelfRequest, SelfProfileChanges } from './employees.service';

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

  // --- Mobile app routes: deliberately UNGUARDED. --------------------------
  // The Flutter app sends no Authorization header yet, so requiring a token
  // here would lock every employee out of the app. See the note at the bottom
  // of this file.
  @Get('me')
  findMe(@Query('authUid') authUid: string) {
    return this.employeesService.findByAuthUid(authUid);
  }

  @Patch('me')
  updateMe(@Query('authUid') authUid: string, @Body() changes: SelfProfileChanges) {
    return this.employeesService.updateSelf(authUid, changes);
  }

  @Post('register')
  registerSelf(@Body() request: RegisterSelfRequest) {
    return this.employeesService.registerSelf(request);
  }

  // --- Dashboard only again. ------------------------------------------------
  @UseGuards(AdminGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() changes: Partial<Employee>,
    @Req() req: any,
  ) {
    return this.employeesService.update(id, changes, req.adminEmail);
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
