import { Module } from '@nestjs/common';
import { StockTakeService } from './stocktake.service';
import { StockTakeActions } from './stocktake.actions';

@Module({
  providers: [StockTakeService, StockTakeActions],
  exports: [StockTakeService],
})
export class StockTakeModule {}
