import { Module } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayActions } from './putaway.actions';

@Module({
  providers: [PutawayService, PutawayActions],
  exports: [PutawayService],
})
export class PutawayModule {}