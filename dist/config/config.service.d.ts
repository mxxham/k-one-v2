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
export declare class ConfigService {
    readonly env: Env;
    constructor();
    get port(): number;
    get jwtSecret(): string;
    get jwtExpiresHours(): number;
    get timezone(): string;
}
