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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const db_service_1 = require("../database/db.service");
const activity_logger_1 = require("../common/activity-logger");
let AuthService = class AuthService {
    db;
    activity;
    constructor(db, activity) {
        this.db = db;
        this.activity = activity;
    }
    async issueToken(userId) {
        const token = (0, crypto_1.randomBytes)(32).toString('hex');
        await this.db.query(`INSERT INTO auth_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '12 hours')`, [userId, token]);
        return token;
    }
    async revokeToken(req) {
        const auth = req.headers?.authorization ?? '';
        let token = null;
        if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
            token = auth.slice(7);
        }
        if (!token)
            return;
        await this.db.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        activity_logger_1.ActivityLogger])
], AuthService);
//# sourceMappingURL=auth.service.js.map