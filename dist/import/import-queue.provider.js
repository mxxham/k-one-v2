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
exports.ImportQueueProvider = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const config_service_1 = require("../config/config.service");
const shared_1 = require("@k-one/shared");
let ImportQueueProvider = class ImportQueueProvider {
    redis;
    queue;
    events;
    queueName = shared_1.QUEUE.IMPORT;
    constructor(config) {
        const host = config.env.REDIS_HOST;
        const port = config.env.REDIS_PORT;
        const url = `redis://${host}:${port}`;
        const connection = { host, port };
        this.redis = new ioredis_1.default(url, { maxRetriesPerRequest: null });
        this.queue = new bullmq_1.Queue(this.queueName, { connection });
        this.events = new bullmq_1.QueueEvents(this.queueName, { connection });
    }
    async enqueue(taskId, data) {
        await this.queue.add(taskId, data, { jobId: taskId, removeOnComplete: 100, removeOnFail: 100 });
    }
    async onModuleDestroy() {
        try {
            await this.events.close();
            await this.queue.close();
            await this.redis.quit();
        }
        catch {
        }
    }
};
exports.ImportQueueProvider = ImportQueueProvider;
exports.ImportQueueProvider = ImportQueueProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_service_1.ConfigService])
], ImportQueueProvider);
//# sourceMappingURL=import-queue.provider.js.map