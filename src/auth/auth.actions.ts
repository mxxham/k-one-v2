import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../database/db.service';
import { AuthService } from './auth.service';
import { ActivityLogger } from '../common/activity-logger';
import { registerActions, RequestContext } from '../dispatcher/registry';
import { ApiException } from '../common/api-exception';

interface UserRow {
  id: number;
  username: string;
  password: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean | number;
}

@Injectable()
export class AuthActions {
  constructor(
    private readonly db: DbService,
    private readonly authService: AuthService,
    private readonly activity: ActivityLogger,
  ) {
    registerActions('auth', {
      login: (ctx) => this.login(ctx),
      logout: (ctx) => this.logout(ctx),
      me: (ctx) => this.me(ctx),
    });
  }

  private async login(ctx: RequestContext): Promise<Record<string, any>> {
    const username = String(ctx.body.username ?? '').trim();
    const password = String(ctx.body.password ?? '');
    if (username === '' || password === '') {
      throw ApiException.badRequest('Username dan password wajib diisi.');
    }
    const r = await this.db.query<UserRow>(
      'SELECT * FROM users WHERE username = $1 LIMIT 1',
      [username],
    );
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw ApiException.unauthorized('Username atau password salah.');
    }
    if (Number(user.is_active) !== 1) {
      throw ApiException.forbidden('Akun nonaktif. Hubungi administrator.');
    }
    const token = await this.authService.issueToken(user.id);
    await this.activity.log(
      'LOGIN',
      'auth',
      'User',
      user.id,
      null,
      'User login: ' + user.username,
      null,
      null,
      { user_id: user.id, username: user.username, full_name: user.full_name, ip_address: this.ip(ctx) },
    );
    return {
      token,
      user: {
        id: Number(user.id),
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    };
  }

  private async logout(ctx: RequestContext): Promise<Record<string, any>> {
    await this.authService.revokeToken(ctx.raw);
    return { message: 'Logged out' };
  }

  private async me(ctx: RequestContext): Promise<Record<string, any>> {
    return { user: ctx.user };
  }

  private ip(ctx: RequestContext): string {
    return ctx.raw?.ip ?? null;
  }
}