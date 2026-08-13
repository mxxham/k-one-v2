import { Module } from '@nestjs/common';
import { ExcelExportService } from './excel-export.service';
import { PrintService } from './print.service';
import { ExportActions } from './export.actions';
import { InboundModule } from '../inbound/inbound.module';
import { OutboundModule } from '../outbound/outbound.module';
import { PicklistModule } from '../picklist/picklist.module';
import { ReportModule } from '../report/report.module';
import { StockTakeModule } from '../stocktake/stocktake.module';

@Module({
  imports: [InboundModule, OutboundModule, PicklistModule, ReportModule, StockTakeModule],
  providers: [ExcelExportService, PrintService, ExportActions],
})
export class ExportModule {}
