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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withLock = exports.RedisLockService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const shared_1 = require("@k-one/shared");
Object.defineProperty(exports, "withLock", { enumerable: true, get: function () { return shared_1.withLock; } });
const config_service_1 = require("../config/config.service");
let RedisLockService = class RedisLockService {
    logger = new common_1.Logger('RedisLock');
    redis;
    ready = false;
    constructor(config) {
        this.redis = new ioredis_1.default({ host: config.env.REDIS_HOST, port: config.env.REDIS_PORT, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, retryStrategy: () => null });
        this.redis.on('connect', () => {
            this.ready = true;
        });
        this.redis.on('error', () => {
            this.ready = false;
        });
    }
    async runLocked(name, fn, opts = {}) {
        if (!this.ready) {
            return fn();
        }
        try {
            const lock = new shared_1.RedisLock(this.redis);
            const release = await lock.acquireBlocking(name, opts.ttlMs, opts.waitMs);
            if (!release) {
                return fn();
            }
            try {
                return await fn();
            }
            finally {
                await release();
            }
        }
        catch (e) {
            this.logger.warn(`lock ${name} unavailable (${e?.message ?? e}) — proceeding unlocked`);
            return fn();
        }
    }
};
exports.RedisLockService = RedisLockService;
exports.RedisLockService = RedisLockService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_service_1.ConfigService])
], RedisLockService);
//# sourceMappingURL=redis-lock.service.js.map