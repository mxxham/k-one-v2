import { Module } from '@nestjs/common';
import { InboundService } from './inbound.service';
import { InboundActions } from './inbound.actions';
import { MasterModule } from '../master/master.module';

@Module({
  imports: [MasterModule],
  providers: [InboundService, InboundActions],
  exports: [InboundService],
})
export class InboundModule {}
