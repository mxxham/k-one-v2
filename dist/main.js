"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const dotenv_1 = require("dotenv");
const path_1 = require("path");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, '../.env') });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const multer_1 = __importDefault(require("multer"));
const app_module_1 = require("./app.module");
const exception_filter_1 = require("./common/exception-filter");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
    }));
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
    app.use(upload.any());
    app.useGlobalFilters(new exception_filter_1.ApiExceptionFilter());
    app.enableCors();
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    process.stdout.write(`K-one API listening on :${port}\n`);
}
bootstrap();
//# sourceMappingURL=main.js.map