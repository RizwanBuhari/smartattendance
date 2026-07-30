// Swagger schemas for the native-geofence event endpoints.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeofenceEventDto {
  @ApiProperty({
    enum: ['ENTER', 'DWELL', 'EXIT', 'RETURN'],
    example: 'EXIT',
    description:
      'What the OS geofence reported.\n\n' +
      '- `ENTER` — crossed into the radius, no open shift.\n' +
      '- `RETURN` — crossed in while already checked in.\n' +
      '- `DWELL` — still inside after the loitering delay (5 min). This is the ' +
      'confirmation that matters: a bare ENTER can be someone driving past.\n' +
      '- `EXIT` — left the radius.',
  })
  eventType: 'ENTER' | 'DWELL' | 'EXIT' | 'RETURN';

  @ApiProperty({
    example: 'auto_3',
    description: 'The approved location whose geofence fired.',
  })
  locationId: string;

  @ApiProperty({ example: '2026-07-30T11:42:03.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6' })
  deviceId: string;

  @ApiProperty({
    example: 'NATIVE_GEOFENCE',
    description: 'Provenance of the event.',
  })
  source: string;

  @ApiPropertyOptional({
    example: 25.1193,
    description:
      'Position at the moment the event fired. **Optional** — the background ' +
      'isolate reads location on a 10 second timeout and legitimately fails ' +
      'sometimes. When supplied, the server measures it against the radius and ' +
      'records the result in `serverCheck`; when absent the event is stored but ' +
      'cannot be cross-checked.',
  })
  latitude?: number;

  @ApiPropertyOptional({ example: 55.3773 })
  longitude?: number;

  @ApiPropertyOptional({ example: 12.4 })
  gpsAccuracy?: number;

  @ApiPropertyOptional({ example: '2026-07-30T09:02:11.000Z' })
  enteredAt?: string;

  @ApiPropertyOptional({ example: '2026-07-30T09:07:11.000Z' })
  dwellConfirmedAt?: string;

  @ApiPropertyOptional({ example: '2026-07-30T11:42:03.000Z' })
  exitedAt?: string;

  @ApiPropertyOptional({
    example: 9292,
    description: 'Seconds spent inside, for an EXIT.',
  })
  totalInsideDurationSeconds?: number;

  @ApiPropertyOptional({
    example: 'auto_17',
    description:
      'The open shift this belongs to. Resolved server-side when omitted.',
  })
  attendanceId?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'True when the employee left before DWELL was ever confirmed — a ' +
      'transient boundary crossing rather than a real departure from work.',
  })
  isBrief?: boolean;
}

export class ServerCheckDto {
  @ApiProperty({ example: 4210, nullable: true })
  distanceMeters: number | null;

  @ApiProperty({ example: 100, nullable: true })
  radiusMeters: number | null;

  @ApiProperty({
    example: false,
    nullable: true,
    description:
      "The server's own verdict from the reported coordinates. Null when the " +
      'event carried no position, or the fix was too poor to judge.',
  })
  serverSaysInside: boolean | null;

  @ApiProperty({
    example: true,
    description:
      'True when the reported `eventType` disagrees with the coordinates in ' +
      'the same payload — an ENTER from 4km away, or an EXIT from the middle ' +
      'of the site. Either the OS geofence misfired or events are being forged. ' +
      'The event is still stored: this is an audit trail, and discarding ' +
      'inconvenient evidence would defeat its purpose.',
  })
  contradictsClaim: boolean;

  @ApiProperty({ example: 'outside_radius', nullable: true })
  reason: string | null;
}

export class ExitReasonDto {
  @ApiProperty({
    example: 'Collecting materials from the supplier, back by 14:00.',
    description: "The employee's explanation for leaving the approved area.",
  })
  reason: string;

  @ApiPropertyOptional({
    example: 'auto_88',
    description: 'The specific EXIT event being explained.',
  })
  eventId?: string;

  @ApiPropertyOptional({ example: 'auto_3' })
  locationId?: string;
}
