import { Injectable } from '@nestjs/common';

export interface Env {
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASS: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  JWT_SECRET: string;
  JWT_EXPIRES_HOURS: number;
  TIMEZONE: string;
  API_ENV: string;
}

function int(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === '' ? def : Number.parseInt(v, 10);
}

@Injectable()
export class ConfigService {
  readonly env: Env;

  constructor() {
    this.env = {
      PORT: int('PORT', 3000),
      DB_HOST: process.env.DB_HOST ?? 'localhost',
      DB_PORT: int('DB_PORT', 5432),
      DB_NAME: process.env.DB_NAME ?? 'k_one',
      DB_USER: process.env.DB_USER ?? 'kone',
      DB_PASS: process.env.DB_PASS ?? 'kone',
      REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
      REDIS_PORT: int('REDIS_PORT', 6379),
      JWT_SECRET: process.env.JWT_SECRET ?? 'k-one-dev-secret-change-me',
      JWT_EXPIRES_HOURS: int('JWT_EXPIRES_HOURS', 12),
      TIMEZONE: process.env.TIMEZONE ?? 'Asia/Jakarta',
      API_ENV: process.env.API_ENV ?? 'dev',
    };
  }

  get port(): number {
    return this.env.PORT;
  }

  get jwtSecret(): string {
    return this.env.JWT_SECRET;
  }

  get jwtExpiresHours(): number {
    return this.env.JWT_EXPIRES_HOURS;
  }

  get timezone(): string {
    return this.env.TIMEZONE;
  }
}