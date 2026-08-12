import { Controller, Get, Post, Req, Body, Query, HttpCode, NotFoundException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { getActionHandler, knownModule, getPermission } from './registry';
import { resolveUser } from '../auth/guards';
import { DbService } from '../database/db.service';
import { ApiException } from '../common/api-exception';

const PUBLIC_ACTIONS = new Set([
  'auth::login',
  'import::tpl_inbound',
  'import::tpl_outbound',
  'import::tpl_stock',
]);

/**
 * Parity gateway. Mirrors api/index.php: reads ?module=&action=, resolves the
 * Bearer token user, runs the registered handler, and wraps output in
 * {success:true, ...}. Errors are handled by the ApiExceptionFilter so they
 * come back as {success:false, message} with proper HTTP codes.
 */
@Controller('index.php')
export class GatewayController {
  private readonly logger = new Logger('Gateway');

  constructor(private readonly db: DbService) {}

  @Get()
  async get(@Query() query: Record<string, any>, @Req() req: Request): Promise<Record<string, any>> {
    return this.handle(query, req);
  }

  @Post()
  @HttpCode(200)
  async post(
    @Query() query: Record<string, any>,
    @Body() body: Record<string, any>,
    @Req() req: Request,
  ): Promise<Record<string, any>> {
    const merged = { ...query, ...body };
    if (!query.module || !query.action) {
      // PHP merges POST params into query-space; here body may carry module/action too.
      return this.handle(merged, req, body);
    }
    return this.handle(query, req, body);
  }

  private async handle(query: Record<string, any>, req: Request, body: Record<string, any> = {}): Promise<Record<string, any>> {
    const module = String(query.module ?? '');
    const action = String(query.action ?? '');
    if (module === '' || action === '') {
      return { message: 'K-one API', version: '2.0.0', time: new Date().toISOString() };
    }
    if (!knownModule(module)) {
      throw new NotFoundException('Unknown module: ' + module);
    }
    const handler = getActionHandler(module, action);
    if (!handler) {
      throw new NotFoundException('Invalid action: ' + action);
    }

    // Auth resolution (parity with api_current_user / api_require_auth).
    const publicKey = `${module}::${action}`;
    let user = null;
    if (!PUBLIC_ACTIONS.has(publicKey)) {
      user = await resolveUser(this.db, req);
      if (!user) {
        throw ApiException.unauthorized();
      }
      const level = getPermission(module, action);
      if (level === 'write' || level === 'admin') {
        const writeRoles = ['admin', 'operator', 'warehouse', 'supervisor', 'staff'];
        if (!writeRoles.includes(user.role)) {
          throw ApiException.forbidden('Akses ditolak. Role Anda tidak memiliki izin untuk mengubah data.');
        }
      }
      if (level === 'admin' && user.role !== 'admin') {
        throw ApiException.forbidden('Akses ditolak. Khusus admin.');
      }
    }

    const result = (await handler({
      user: user as any,
      query: { ...query } as Record<string, any>,
      body: body as Record<string, any>,
      raw: req,
    })) ?? {};

    return { success: true, ...result };
  }
}