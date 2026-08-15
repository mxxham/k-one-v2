import { Module } from '@nestjs/common';
import { AsnService } from './asn.service';
import { AsnActions } from './asn.actions';

@Module({
  providers: [AsnService, AsnActions],
  exports: [AsnService],
})
export class AsnModule {}