// Swagger schemas for the approved-work-location endpoints.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLocationDto {
  @ApiProperty({
    example: 'Dubai Silicon Oasis Office',
    description: 'Display name, shown on the mobile app and every record.',
  })
  name: string;

  @ApiProperty({ example: 25.1193, minimum: -90, maximum: 90 })
  latitude: number;

  @ApiProperty({ example: 55.3773, minimum: -180, maximum: 180 })
  longitude: number;

  @ApiProperty({
    example: 100,
    minimum: 1,
    description:
      'Allowed radius in metres. This is the figure every check-in is judged ' +
      'against — the server measures the haversine distance from the device to ' +
      'the centre above and compares it to this. Editing it takes effect on the ' +
      'next check-in (the locations cache is invalidated on write).\n\n' +
      'Bear in mind a phone reports ±3-10m outdoors and ±20-40m indoors, so a ' +
      'radius below about 50m will produce refusals for people who are ' +
      'genuinely on site.',
  })
  radiusMeters: number;

  @ApiPropertyOptional({
    enum: ['site', 'office'],
    example: 'office',
    description:
      'Governs how strict check-in is. `office` is geofence-only. Absent is ' +
      'treated as `office`, so existing locations keep working unchanged.',
  })
  type?: 'site' | 'office';
}

export class UpdateLocationDto {
  @ApiPropertyOptional({ example: 'Dubai Silicon Oasis Office' })
  name?: string;

  @ApiPropertyOptional({ example: 25.1193 })
  latitude?: number;

  @ApiPropertyOptional({ example: 55.3773 })
  longitude?: number;

  @ApiPropertyOptional({ example: 150 })
  radiusMeters?: number;

  @ApiPropertyOptional({ enum: ['site', 'office'] })
  type?: 'site' | 'office';
}

export class StoredLocationDto extends CreateLocationDto {
  @ApiProperty({ example: 'auto_3', description: 'Firestore document id.' })
  id: string;
}
