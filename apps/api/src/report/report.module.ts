import { Module } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportActions } from './report.actions';
import { InboundModule } from '../inbound/inbound.module';
import { OutboundModule } from '../outbound/outbound.module';

@Module({
  imports: [InboundModule, OutboundModule],
  providers: [ReportService, ReportActions],
  exports: [ReportService],
})
export class ReportModule {}
