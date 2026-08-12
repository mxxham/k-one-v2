import { Module, Global } from '@nestjs/common';
import { ActivityLogger } from '../common/activity-logger';
import { AuthService } from '../auth/auth.service';

@Global()
@Module({
  providers: [ActivityLogger, AuthService],
  exports: [ActivityLogger, AuthService],
})
export class CommonModule {}