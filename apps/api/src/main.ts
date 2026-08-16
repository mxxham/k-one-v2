import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import multer from 'multer';
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
  // Multipart uploads (import module). multer only parses multipart/form-data;
  // JSON bodies pass through untouched and are handled by Nest's body parser.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
  app.use(upload.any());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  process.stdout.write(`K-one API listening on :${port}\n`);
}

bootstrap();