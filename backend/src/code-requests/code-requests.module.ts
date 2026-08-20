// Tracks employees waiting for a site admin to approve their check-in.
import { Module } from '@nestjs/common';
import { CodeRequestsService } from './code-requests.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  providers: [CodeRequestsService],
  exports: [CodeRequestsService],
})
export class CodeRequestsModule {}
