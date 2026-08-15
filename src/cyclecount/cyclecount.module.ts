import { Module } from '@nestjs/common';
import { CycleCountService } from './cyclecount.service';
import { CycleCountActions } from './cyclecount.actions';
import { StockTakeModule } from '../stocktake/stocktake.module';

@Module({
  imports: [StockTakeModule],
  providers: [CycleCountService, CycleCountActions],
  exports: [CycleCountService],
})
export class CycleCountModule {}