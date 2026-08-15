"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthActions = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const db_service_1 = require("../database/db.service");
const auth_service_1 = require("./auth.service");
const activity_logger_1 = require("../common/activity-logger");
const registry_1 = require("../dispatcher/registry");
const api_exception_1 = require("../common/api-exception");
let AuthActions = class AuthActions {
    db;
    authService;
    activity;
    constructor(db, authService, activity) {
        this.db = db;
        this.authService = authService;
        this.activity = activity;
        (0, registry_1.registerActions)('auth', {
            login: (ctx) => this.login(ctx),
            logout: (ctx) => this.logout(ctx),
            me: (ctx) => this.me(ctx),
        });
    }
    async login(ctx) {
        const username = String(ctx.body.username ?? '').trim();
        const password = String(ctx.body.password ?? '');
        if (username === '' || password === '') {
            throw api_exception_1.ApiException.badRequest('Username dan password wajib diisi.');
        }
        const r = await this.db.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
        const user = r.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw api_exception_1.ApiException.unauthorized('Username atau password salah.');
        }
        if (Number(user.is_active) !== 1) {
            throw api_exception_1.ApiException.forbidden('Akun nonaktif. Hubungi administrator.');
        }
        const token = await this.authService.issueToken(user.id);
        await this.activity.log('LOGIN', 'auth', 'User', user.id, null, 'User login: ' + user.username, null, null, { user_id: user.id, username: user.username, full_name: user.full_name, ip_address: this.ip(ctx) });
        return {
            token,
            user: {
                id: Number(user.id),
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                department: user.department ?? 'all',
            },
        };
    }
    async logout(ctx) {
        await this.authService.revokeToken(ctx.raw);
        return { message: 'Logged out' };
    }
    async me(ctx) {
        return { user: ctx.user };
    }
    ip(ctx) {
        return ctx.raw?.ip ?? null;
    }
};
exports.AuthActions = AuthActions;
exports.AuthActions = AuthActions = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService,
        auth_service_1.AuthService,
        activity_logger_1.ActivityLogger])
], AuthActions);
//# sourceMappingURL=auth.actions.js.map