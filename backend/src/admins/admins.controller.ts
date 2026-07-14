// Routes for admin authorization.
//   GET    /admins/verify  -> dashboard checks the logged-in user is an admin
//   GET    /admins         -> list admins
//   POST   /admins         -> add an admin by email
//   DELETE /admins/:id     -> remove an admin
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { AdminsService } from './admins.service';

@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  // Called by the dashboard right after login. The Firebase ID token comes in
  // the Authorization header ("Bearer <token>"). Returns { isAdmin }.
  @Get('verify')
  verify(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    return this.adminsService.verify(token);
  }

  @Get()
  findAll() {
    return this.adminsService.findAll();
  }

  @Post()
  add(@Body('email') email: string) {
    return this.adminsService.add(email);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminsService.remove(id);
  }
}
