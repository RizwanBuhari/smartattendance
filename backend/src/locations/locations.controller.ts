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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { AdminGuard } from '../auth/admin.guard';
import {
  CreateLocationDto,
  UpdateLocationDto,
  StoredLocationDto,
} from './dto/location.dto';
import type { Location } from './locations.service';

// Every route here is admin-only: the mobile app does NOT use this API for
// locations — it reads the locations_ids collection from Firestore directly —
// so guarding all four is safe.
@ApiTags('Locations')
@ApiBearerAuth('firebase')
@ApiResponse({ status: 403, description: 'Caller is not an administrator.' })
@UseGuards(AdminGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List approved work locations',
    description:
      'Every configured site with its geofence centre and radius. Cached for ' +
      '60 seconds — writes through this API invalidate the cache immediately, ' +
      'but an edit made directly in the Firebase console can take up to a ' +
      'minute to be noticed.',
  })
  @ApiResponse({ status: 200, type: [StoredLocationDto] })
  findAll() {
    return this.locationsService.findAll();
  }

  @Post()
  @ApiOperation({
    summary: 'Create an approved work location',
    description:
      'The mobile app registers a native OS geofence per assigned location, so ' +
      'a new site starts producing ENTER/DWELL/EXIT events on the next sync.',
  })
  @ApiBody({ type: CreateLocationDto })
  @ApiResponse({ status: 201, type: StoredLocationDto })
  create(@Body() location: Location) {
    return this.locationsService.create(location);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a location',
    description:
      'Partial update of name, centre, radius or type. The locations cache is ' +
      'invalidated before returning, so a changed radius applies to the very ' +
      'next check-in.',
  })
  @ApiParam({ name: 'id', description: 'Location document id.' })
  @ApiBody({ type: UpdateLocationDto })
  @ApiResponse({ status: 200, type: StoredLocationDto })
  update(@Param('id') id: string, @Body() changes: Partial<Location>) {
    return this.locationsService.update(id, changes);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a location',
    description:
      'Also removes the id from every employee\'s `assignedLocationIds` in the ' +
      'same batch — otherwise the orphaned id would render as a raw document ' +
      'id on the dashboard — and clears the affected employees\' cached auth ' +
      'records so the mobile geofence sync sees the site gone.',
  })
  @ApiParam({ name: 'id', description: 'Location document id.' })
  @ApiResponse({
    status: 200,
    description: 'Deleted, with a count of employees it was unassigned from.',
    schema: {
      example: { id: 'auto_3', unassignedFrom: 4 },
    },
  })
  remove(@Param('id') id: string) {
    return this.locationsService.remove(id);
  }
}
