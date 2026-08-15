import { Module } from '@nestjs/common';
import { ReplenishmentService } from './replenishment.service';
import { ReplenishmentActions } from './replenishment.actions';
import { BinTransferModule } from '../bintransfer/bintransfer.module';

@Module({
  imports: [BinTransferModule],
  providers: [ReplenishmentService, ReplenishmentActions],
  exports: [ReplenishmentService],
})
export class ReplenishmentModule {}