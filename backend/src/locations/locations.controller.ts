// Maps HTTP requests to the LocationsService.
//
// Routes (all under /locations):
//   GET    /locations       -> list all approved sites
//   POST   /locations       -> create one (body = location fields)
//   PATCH  /locations/:id    -> update one (name / coordinates / radius)
//   DELETE /locations/:id    -> remove one
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { LocationsService } from './locations.service';
import type { Location } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  findAll() {
    return this.locationsService.findAll();
  }

  @Post()
  create(@Body() location: Location) {
    return this.locationsService.create(location);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() changes: Partial<Location>) {
    return this.locationsService.update(id, changes);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationsService.remove(id);
  }
}
