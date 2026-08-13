import { HttpException, HttpStatus } from '@nestjs/common';
export declare class ApiException extends HttpException {
    constructor(message: string, status?: HttpStatus, extra?: Record<string, unknown>);
}
export declare class NotFoundException extends ApiException {
    constructor(message?: string);
}
export declare class ForbiddenException extends ApiException {
    constructor(message?: string);
}
export declare class UnauthorizedException2 extends ApiException {
    constructor(message?: string);
}
export declare namespace ApiException {
    function badRequest(message: string): ApiException;
    function unauthorized(message?: string): ApiException;
    function forbidden(message: string): ApiException;
    function conflict(message: string): ApiException;
    function notFound(message: string): ApiException;
}
export declare function toApiErrorResponse(error: unknown): {
    success: false;
    message: string;
};
