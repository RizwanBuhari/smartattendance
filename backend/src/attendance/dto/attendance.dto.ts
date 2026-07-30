// Swagger schemas for the attendance endpoints.
//
// These classes exist for documentation, not for runtime validation — that is
// GeoPayloadPipe's job (see common/validation/geo-payload.pipe.ts). Keeping the
// two separate is deliberate: the pipe enforces domain rules like "not Null
// Island" and "not three days in the future" that a schema annotation cannot
// express, while these classes give the generated OpenAPI document real field
// descriptions instead of `object`.
//
// The services keep their own `AttendanceEvent` interface as the internal
// contract; these mirror the wire format.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInDto {
  @ApiProperty({
    example: 25.1193,
    minimum: -90,
    maximum: 90,
    description:
      'Latitude of the device at the moment of check-in. Required — an ' +
      'attendance event without a position is rejected.',
  })
  latitude: number;

  @ApiProperty({
    example: 55.3773,
    minimum: -180,
    maximum: 180,
    description: 'Longitude of the device at the moment of check-in.',
  })
  longitude: number;

  @ApiPropertyOptional({
    example: 8.5,
    minimum: 0,
    description:
      'Radius of the GPS fix in metres, as reported by the OS. A fix worse ' +
      'than MAX_GPS_ACCURACY_METRES (default 50) is refused with ' +
      '`reason: "poor_accuracy"` — the server will not place someone inside a ' +
      'radius on a cell-tower estimate. Up to 25m of this figure is also ' +
      'allowed to count in the employee\'s favour at the geofence boundary.',
  })
  gpsAccuracy?: number;

  @ApiPropertyOptional({
    example: '2026-07-30T08:15:00.000Z',
    description:
      'UTC ISO-8601 instant of the event. Defaults to server time when ' +
      'omitted. Rejected if more than 5 minutes in the future or 7 days in ' +
      'the past (the window the mobile offline queue needs).',
  })
  timestamp?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4e5f6',
    description:
      'Identifier for the physical device, stored on the record so attendance ' +
      'can be traced back to a handset.',
  })
  deviceId?: string;

  @ApiPropertyOptional({
    example: 240,
    minimum: -720,
    maximum: 840,
    description:
      "The device's UTC offset in minutes. Timestamps are always STORED in " +
      'UTC; this is kept alongside so the dashboard can render them in the ' +
      "employee's local time. Falls back to +240 (Dubai) when absent.",
  })
  tzOffsetMinutes?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      "The phone's own geofence opinion. **Not the decision** — the server " +
      'computes that from the coordinates above. Supplying `true` from outside ' +
      'an approved radius does not grant a check-in; it records ' +
      '`verification.clientDisagreed: true` against the attempt.',
  })
  isInsideGeofence?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Whether the native geofence confirmed a DWELL (loitering past the 5 ' +
      'minute delay) rather than a bare boundary crossing. Recorded for the ' +
      'audit trail.',
  })
  isDwellConfirmed?: boolean;
}

export class CheckOutDto extends CheckInDto {}

// --- Response schemas -----------------------------------------------------

export class GeofenceVerificationDto {
  @ApiProperty({
    example: 42,
    nullable: true,
    description:
      'Server-measured haversine distance to the resolved location, in ' +
      'metres. Null only when the position could not be judged at all.',
  })
  distanceMeters: number | null;

  @ApiProperty({
    example: 100,
    nullable: true,
    description: 'The configured radius the distance was judged against.',
  })
  radiusMeters: number | null;

  @ApiProperty({
    example: 8.5,
    description:
      'How much of the reported GPS accuracy was actually allowed at the ' +
      'boundary, after the 25m cap.',
  })
  accuracyBufferApplied: number;

  @ApiProperty({
    enum: [
      'inside',
      'invalid_coordinates',
      'poor_accuracy',
      'no_approved_locations',
      'outside_radius',
    ],
    example: 'inside',
    description: 'Machine-readable cause of the verdict.',
  })
  reason: string;

  @ApiProperty({
    example: true,
    nullable: true,
    description: 'What the device claimed, or null if it said nothing.',
  })
  clientClaimedInside: boolean | null;

  @ApiProperty({
    example: false,
    description:
      "True when the device's claim contradicted the server's measurement. " +
      'The fraud signal — surface this in any investigation view.',
  })
  clientDisagreed: boolean;

  @ApiProperty({
    example: 'server',
    description:
      'Who made the decision. Always "server"; present so a record written ' +
      'by an older client-trusting build is distinguishable.',
  })
  verifiedBy: string;
}

export class CheckInAcceptedDto {
  @ApiProperty({ example: true })
  accepted: boolean;

  @ApiProperty({ example: 'auto_17', description: 'Attendance record id.' })
  id: string;

  @ApiProperty({ example: 'Accepted! 42m from Dubai Office.' })
  message: string;

  @ApiProperty({ example: 'checked_in', enum: ['checked_in'] })
  status: string;

  @ApiProperty({ example: 'Dubai Office', nullable: true })
  locationName: string | null;

  @ApiProperty({ example: '2026-07-30T08:15:00.000Z' })
  checkInUtc: string;

  @ApiProperty({ example: 240 })
  tzOffsetMinutes: number;

  @ApiProperty({ type: GeofenceVerificationDto })
  verification: GeofenceVerificationDto;
}

export class CheckInRejectedDto {
  @ApiProperty({
    example: false,
    description:
      'A refused check-in is still HTTP 201 with `accepted: false` — the ' +
      'request was well-formed, the location was not. Clients branch on this ' +
      'field, not on the status code.',
  })
  accepted: boolean;

  @ApiProperty({
    example:
      'Rejected! You are 412m from Dubai Office, outside its 100m approved radius.',
    description:
      'Specific and actionable. "Your GPS is ±80m" and "you are 400m away" ' +
      'need different responses from the employee.',
  })
  message: string;

  @ApiProperty({
    enum: [
      'invalid_coordinates',
      'poor_accuracy',
      'no_approved_locations',
      'outside_radius',
    ],
    example: 'outside_radius',
  })
  reason: string;

  @ApiProperty({ example: 412, nullable: true })
  distanceMeters: number | null;

  @ApiProperty({ example: 100, nullable: true })
  radiusMeters: number | null;
}

export class CheckOutResultDto {
  @ApiProperty({ example: true })
  accepted: boolean;

  @ApiProperty({ example: 'auto_17' })
  id: string;

  @ApiProperty({ example: 'Checked out successfully.' })
  message: string;

  @ApiProperty({
    example: false,
    description:
      'True when the checkout happened outside the approved radius. The ' +
      'session still closes — an employee ending a shift must never get stuck ' +
      'permanently checked in — but a pending review is opened for an admin.',
  })
  checkoutFlagged: boolean;

  @ApiProperty({ example: null, nullable: true })
  distanceMeters: number | null;
}

export class RejectReviewDto {
  @ApiPropertyOptional({
    example: 'Left site without notifying the supervisor.',
    description: 'Recorded on the record as `checkoutReview.rejectionReason`.',
  })
  reason?: string;
}
