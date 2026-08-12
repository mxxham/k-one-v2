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

@Module({
  imports: [ConfigModule, DatabaseModule, CommonModule, DispatcherModule, AuthModule, MasterModule, StockModule, InboundModule, OutboundModule],
})
export class AppModule {}