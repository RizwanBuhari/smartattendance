import { Module } from '@nestjs/common';
import { OffsiteCheckinController } from './offsite-checkin.controller';
import { OffsiteCheckinService } from './offsite-checkin.service';
import { OffsiteQrTokenService } from './offsite-qr-token.service';
import { OtpModule } from '../otp/otp.module';
import { PushModule } from '../push/push.module';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [OtpModule, PushModule, LocationsModule],
  controllers: [OffsiteCheckinController],
  providers: [OffsiteCheckinService, OffsiteQrTokenService],
  exports: [OffsiteCheckinService, OffsiteQrTokenService],
})
export class OffsiteCheckinModule {}
