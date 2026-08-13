"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnauthorizedException2 = exports.ForbiddenException = exports.NotFoundException = exports.ApiException = void 0;
exports.toApiErrorResponse = toApiErrorResponse;
const common_1 = require("@nestjs/common");
class ApiException extends common_1.HttpException {
    constructor(message, status = common_1.HttpStatus.BAD_REQUEST, extra) {
        super({ success: false, message, ...(extra ?? {}) }, status);
    }
}
exports.ApiException = ApiException;
class NotFoundException extends ApiException {
    constructor(message = 'Data tidak ditemukan') {
        super(message, common_1.HttpStatus.NOT_FOUND);
    }
}
exports.NotFoundException = NotFoundException;
class ForbiddenException extends ApiException {
    constructor(message = 'Akses ditolak') {
        super(message, common_1.HttpStatus.FORBIDDEN);
    }
}
exports.ForbiddenException = ForbiddenException;
class UnauthorizedException2 extends ApiException {
    constructor(message = 'Unauthorized') {
        super(message, common_1.HttpStatus.UNAUTHORIZED);
    }
}
exports.UnauthorizedException2 = UnauthorizedException2;
(function (ApiException) {
    function badRequest(message) {
        return new ApiException(message, common_1.HttpStatus.BAD_REQUEST);
    }
    ApiException.badRequest = badRequest;
    function unauthorized(message = 'Unauthorized') {
        return new ApiException(message, common_1.HttpStatus.UNAUTHORIZED);
    }
    ApiException.unauthorized = unauthorized;
    function forbidden(message) {
        return new ApiException(message, common_1.HttpStatus.FORBIDDEN);
    }
    ApiException.forbidden = forbidden;
    function conflict(message) {
        return new ApiException(message, common_1.HttpStatus.CONFLICT);
    }
    ApiException.conflict = conflict;
    function notFound(message) {
        return new ApiException(message, common_1.HttpStatus.NOT_FOUND);
    }
    ApiException.notFound = notFound;
})(ApiException || (exports.ApiException = ApiException = {}));
function toApiErrorResponse(error) {
    if (error instanceof ApiException) {
        return { success: false, message: error.getResponse() };
    }
    if (error instanceof Error) {
        return { success: false, message: error.message };
    }
    return { success: false, message: String(error) };
}
//# sourceMappingURL=api-exception.js.map