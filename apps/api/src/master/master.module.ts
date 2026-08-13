import { Module } from '@nestjs/common';
import { MasterActions } from './master.actions';
import { MasterDataService } from './master-data.service';

@Module({
  providers: [MasterActions, MasterDataService],
  exports: [MasterDataService],
})
export class MasterModule {}