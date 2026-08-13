import { Module, Global } from '@nestjs/common';
import { ActivityLogger } from '../common/activity-logger';
import { AuthService } from '../auth/auth.service';
import { RedisLockService } from './redis-lock.service';

@Global()
@Module({
  providers: [ActivityLogger, AuthService, RedisLockService],
  exports: [ActivityLogger, AuthService, RedisLockService],
})
export class CommonModule {}