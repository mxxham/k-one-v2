import { Module } from '@nestjs/common';
import { WavesService } from './waves.service';
import { WavesActions } from './waves.actions';
import { PicklistModule } from '../picklist/picklist.module';

@Module({
  imports: [PicklistModule],
  providers: [WavesService, WavesActions],
  exports: [WavesService],
})
export class WavesModule {}
