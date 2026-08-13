import { Module } from '@nestjs/common';
import { PicklistService } from './picklist.service';
import { PicklistActions } from './picklist.actions';

@Module({
  providers: [PicklistService, PicklistActions],
  exports: [PicklistService],
})
export class PicklistModule {}
