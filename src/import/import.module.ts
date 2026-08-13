import { Module } from '@nestjs/common';
import { ImportService } from './import.service';
import { ImportActions } from './import.actions';
import { ImportQueueProvider } from './import-queue.provider';

@Module({
  providers: [ImportService, ImportActions, ImportQueueProvider],
  exports: [ImportService],
})
export class ImportModule {}
