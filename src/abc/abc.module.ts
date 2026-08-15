import { Module } from '@nestjs/common';
import { AbcService } from './abc.service';
import { AbcActions } from './abc.actions';

@Module({
  providers: [AbcService, AbcActions],
  exports: [AbcService],
})
export class AbcModule {}