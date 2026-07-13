// Maps HTTP requests to the EmployeesService.
//
// Routes (all under /employees):
//   GET  /employees        -> list all employees
//   POST /employees        -> create one (body = employee fields)
//   POST /employees/seed   -> one-time: insert sample employees
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import type { Employee } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @Post()
  create(@Body() employee: Employee) {
    return this.employeesService.create(employee);
  }

  @Patch(':id')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: Employee['status'],
  ) {
    return this.employeesService.setStatus(id, status);
  }

  @Post('seed')
  seed() {
    return this.employeesService.seed();
  }
}
