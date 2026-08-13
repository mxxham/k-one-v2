import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Parity-compatible API error. PHP returns {success:false, message, error?}.
 * HTTP codes: 400 validation, 401 unauthorized, 403 forbidden, 404 unknown.
 */
export class ApiException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, extra?: Record<string, unknown>) {
    super({ success: false, message, ...(extra ?? {}) }, status);
  }
}

export class NotFoundException extends ApiException {
  constructor(message = 'Data tidak ditemukan') {
    super(message, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenException extends ApiException {
  constructor(message = 'Akses ditolak') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class UnauthorizedException2 extends ApiException {
  constructor(message = 'Unauthorized') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export namespace ApiException {
  export function badRequest(message: string): ApiException {
    return new ApiException(message, HttpStatus.BAD_REQUEST);
  }
  export function unauthorized(message = 'Unauthorized'): ApiException {
    return new ApiException(message, HttpStatus.UNAUTHORIZED);
  }
  export function forbidden(message: string): ApiException {
    return new ApiException(message, HttpStatus.FORBIDDEN);
  }
  export function conflict(message: string): ApiException {
    return new ApiException(message, HttpStatus.CONFLICT);
  }
  export function notFound(message: string): ApiException {
    return new ApiException(message, HttpStatus.NOT_FOUND);
  }
}

/** Wrap any thrown error into the parity {success:false, message} shape. */
export function toApiErrorResponse(error: unknown): { success: false; message: string } {
  if (error instanceof ApiException) {
    return { success: false, message: error.getResponse() as unknown as string };
  }
  if (error instanceof Error) {
    return { success: false, message: error.message };
  }
  return { success: false, message: String(error) };
}