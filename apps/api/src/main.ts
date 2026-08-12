import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/exception-filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  process.stdout.write(`K-one API listening on :${port}\n`);
}

bootstrap();