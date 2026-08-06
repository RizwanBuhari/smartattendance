import { Module } from '@nestjs/common';
import { BiometricsController } from './biometrics.controller';
import { BiometricsService } from './biometrics.service';
import { AdminsModule } from '../admins/admins.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [AdminsModule, PushModule],
  controllers: [BiometricsController],
  providers: [BiometricsService],
  exports: [BiometricsService],
})
export class BiometricsModule {}
