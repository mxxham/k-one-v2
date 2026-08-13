import { Module, Global } from '@nestjs/common';
import { Pool, types } from 'pg';
import { ConfigService } from '../config/config.service';
import { DbService } from './db.service';

// DATE (1082) -> 'YYYY-MM-DD' string (PHP returns raw date strings; pg otherwise yields Date objects).
types.setTypeParser(1082, (v) => v);
// TIMESTAMP (1114) -> keep as string 'YYYY-MM-DD HH:MM:SS'.
types.setTypeParser(1114, (v) => v);

@Global()
@Module({
  providers: [
    DbService,
    {
      provide: 'PG_POOL',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        return new Pool({
          host: cfg.env.DB_HOST,
          port: cfg.env.DB_PORT,
          database: cfg.env.DB_NAME,
          user: cfg.env.DB_USER,
          password: cfg.env.DB_PASS,
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        });
      },
    },
  ],
  exports: [DbService],
})
export class DatabaseModule {}