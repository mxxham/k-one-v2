import { Module } from '@nestjs/common';
import { BinTransferService } from './bintransfer.service';
import { BinTransferActions } from './bintransfer.actions';

@Module({
  providers: [BinTransferService, BinTransferActions],
  exports: [BinTransferService],
})
export class BinTransferModule {}
