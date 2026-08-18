import { Module, forwardRef } from '@nestjs/common';
import { PutawayService } from './putaway.service';
import { PutawayActions } from './putaway.actions';
import { HtmlLabelPrinterService } from './label-printer.service';
import { InboundModule } from '../inbound/inbound.module';

@Module({
  imports: [forwardRef(() => InboundModule)],
  providers: [PutawayService, PutawayActions, HtmlLabelPrinterService],
  exports: [PutawayService],
})
export class PutawayModule {}