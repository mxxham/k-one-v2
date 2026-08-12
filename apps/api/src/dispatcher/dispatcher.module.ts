import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';

@Module({
  providers: [],
  controllers: [GatewayController],
})
export class DispatcherModule {}