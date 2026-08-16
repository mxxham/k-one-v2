import { Module } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayActions } from './putaway.actions';
import { HtmlLabelPrinterService } from './label-printer.service';

@Module({
  providers: [PutawayService, PutawayActions, HtmlLabelPrinterService],
  exports: [PutawayService],
})
export class PutawayModule {}