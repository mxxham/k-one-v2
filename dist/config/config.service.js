"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const common_1 = require("@nestjs/common");
function int(name, def) {
    const v = process.env[name];
    return v === undefined || v === '' ? def : Number.parseInt(v, 10);
}
let ConfigService = class ConfigService {
    env;
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
    get port() {
        return this.env.PORT;
    }
    get jwtSecret() {
        return this.env.JWT_SECRET;
    }
    get jwtExpiresHours() {
        return this.env.JWT_EXPIRES_HOURS;
    }
    get timezone() {
        return this.env.TIMEZONE;
    }
};
exports.ConfigService = ConfigService;
exports.ConfigService = ConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ConfigService);
//# sourceMappingURL=config.service.js.map