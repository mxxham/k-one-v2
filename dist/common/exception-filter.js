"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
let ApiExceptionFilter = class ApiExceptionFilter {
    logger = new common_1.Logger('Filter');
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let body = { success: false, message: 'Internal server error' };
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const resp = exception.getResponse();
            if (typeof resp === 'string') {
                body = { success: false, message: resp };
            }
            else if (typeof resp === 'object' && resp !== null) {
                const r = resp;
                if (r.success === false && r.message) {
                    body = r;
                }
                else {
                    body = { success: false, message: r.message ?? 'Request failed' };
                }
            }
        }
        else if (exception instanceof Error) {
            this.logger.error(exception.message, exception.stack);
            body = { success: false, message: exception.message };
        }
        else {
            body = { success: false, message: String(exception) };
        }
        if (status === common_1.HttpStatus.INTERNAL_SERVER_ERROR) {
            this.logger.error(JSON.stringify(body));
        }
        res.status(status).json(body);
    }
};
exports.ApiExceptionFilter = ApiExceptionFilter;
exports.ApiExceptionFilter = ApiExceptionFilter = __decorate([
    (0, common_1.Catch)()
], ApiExceptionFilter);
//# sourceMappingURL=exception-filter.js.map