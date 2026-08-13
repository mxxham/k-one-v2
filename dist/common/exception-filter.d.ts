import { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
export declare class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): void;
}
