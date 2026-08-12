import { Module } from '@nestjs/common';
import { AuthActions } from './auth.actions';

@Module({
  providers: [AuthActions],
})
export class AuthModule {}