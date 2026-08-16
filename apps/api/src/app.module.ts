import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { AuthModule } from './auth/auth.module';
import { MasterModule } from './master/master.module';
import { StockModule } from './stock/stock.module';
import { InboundModule } from './inbound/inbound.module';
import { OutboundModule } from './outbound/outbound.module';
import { PicklistModule } from './picklist/picklist.module';
import { ReportModule } from './report/report.module';
import { StockTakeModule } from './stocktake/stocktake.module';
import { BinTransferModule } from './bintransfer/bintransfer.module';
import { ReplenishmentModule } from './replenishment/replenishment.module';
import { PutawayModule } from './putaway/putaway.module';
import { WavesModule } from './waves/waves.module';
import { AsnModule } from './asn/asn.module';
import { AbcModule } from './abc/abc.module';
import { CycleCountModule } from './cyclecount/cyclecount.module';
import { ImportModule } from './import/import.module';
import { ExportModule } from './export/export.module';

@Module({
  imports: [ConfigModule, DatabaseModule, CommonModule, DispatcherModule, AuthModule, MasterModule, StockModule, InboundModule, OutboundModule, PicklistModule, ReportModule, StockTakeModule, BinTransferModule, ReplenishmentModule, PutawayModule, WavesModule, AsnModule, AbcModule, CycleCountModule, ImportModule, ExportModule],
})
export class AppModule {}