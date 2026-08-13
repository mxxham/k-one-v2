"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const config_service_1 = require("../config/config.service");
const db_service_1 = require("./db.service");
pg_1.types.setTypeParser(1082, (v) => v);
pg_1.types.setTypeParser(1114, (v) => v);
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            db_service_1.DbService,
            {
                provide: 'PG_POOL',
                inject: [config_service_1.ConfigService],
                useFactory: (cfg) => {
                    return new pg_1.Pool({
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
        exports: [db_service_1.DbService],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map