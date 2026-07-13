// Bundles the company-codes controller + service into one Nest module.
import { Module } from '@nestjs/common';
import { CompanyCodesController } from './company-codes.controller';
import { CompanyCodesService } from './company-codes.service';

@Module({
  controllers: [CompanyCodesController],
  providers: [CompanyCodesService],
})
export class CompanyCodesModule {}
