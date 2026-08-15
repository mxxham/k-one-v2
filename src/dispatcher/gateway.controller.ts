import { Controller, Get, Post, Req, Body, Query, HttpCode, NotFoundException, Logger, Res, StreamableFile } from '@nestjs/common';
import { Request, Response } from 'express';
import { getActionHandler, knownModule, getPermission, getDepartments } from './registry';
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
 * Handlers may return {_binary:true, buffer, filename, contentType} to stream
 * a file download (parity with PHP binary template responses), or
 * {_html:true, html} for an inline HTML document (parity with PHP print pages).
 */
@Controller('index.php')
export class GatewayController {
  private readonly logger = new Logger('Gateway');

  constructor(private readonly db: DbService) {}

  @Get()
  async get(
    @Query() query: Record<string, any>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, any> | StreamableFile | string> {
    return this.handle(query, req, {}, res);
  }

  @Post()
  @HttpCode(200)
  async post(
    @Query() query: Record<string, any>,
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, any> | StreamableFile | string> {
    const merged = { ...query, ...body };
    if (!query.module || !query.action) {
      // PHP merges POST params into query-space; here body may carry module/action too.
      return this.handle(merged, req, body, res);
    }
    return this.handle(query, req, body, res);
  }

  private async handle(
    query: Record<string, any>,
    req: Request,
    body: Record<string, any> = {},
    res?: Response,
  ): Promise<Record<string, any> | StreamableFile | string> {
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
      // Department access control (new-roles.md Phase 0). department === 'all'
      // (admin/supervisor) always passes regardless of the action's list.
      const depts = getDepartments(module, action);
      if (depts && user.department !== 'all' && !depts.includes(user.department)) {
        throw ApiException.forbidden('Akses ditolak. Department Anda tidak memiliki izin untuk modul ini.');
      }
    }

    const result = (await handler({
      user: user as any,
      query: { ...query } as Record<string, any>,
      body: body as Record<string, any>,
      raw: req,
    })) ?? {};

    // Binary file download (template export).
    if (result && typeof result === 'object' && (result as any)._binary) {
      const b = result as any;
      res!.set({
        'Content-Type': b.contentType,
        'Content-Disposition': `attachment; filename="${b.filename}"`,
        'Cache-Control': 'max-age=0',
      });
      return new StreamableFile(b.buffer);
    }

    // Inline HTML document (print pages). Rendered in-browser, no download.
    if (result && typeof result === 'object' && (result as any)._html) {
      const h = result as any;
      res!.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return h.html as string;
    }

    return { success: true, ...result };
  }
}