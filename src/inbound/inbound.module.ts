import { Module } from '@nestjs/common';
import { InboundService } from './inbound.service';
import { InboundActions } from './inbound.actions';
import { MasterModule } from '../master/master.module';
import { PutawayModule } from '../putaway/putaway.module';
import { PicklistModule } from '../picklist/picklist.module';

@Module({
  imports: [MasterModule, PutawayModule, PicklistModule],
  providers: [InboundService, InboundActions],
  exports: [InboundService],
})
export class InboundModule {}