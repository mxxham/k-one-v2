import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Filter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { success: false, message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        body = { success: false, message: resp };
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, any>;
        if (r.success === false && r.message) {
          body = r;
        } else {
          body = { success: false, message: r.message ?? 'Request failed' };
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      body = { success: false, message: exception.message };
    } else {
      body = { success: false, message: String(exception) };
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(JSON.stringify(body));
    }

    res.status(status).json(body);
  }
}