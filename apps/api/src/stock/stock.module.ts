import { Module } from '@nestjs/common';
import { StockActions } from './stock.actions';
import { MasterModule } from '../master/master.module';

@Module({
  imports: [MasterModule],
  providers: [StockActions],
})
export class StockModule {}