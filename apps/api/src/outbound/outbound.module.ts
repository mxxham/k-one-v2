import { Module } from '@nestjs/common';
import { OutboundActions } from './outbound.actions';
import { OutboundService } from './outbound.service';
import { MasterModule } from '../master/master.module';

@Module({
  imports: [MasterModule],
  providers: [OutboundActions, OutboundService],
  exports: [OutboundService],
})
export class OutboundModule {}
