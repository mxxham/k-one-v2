import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { UnauthorizedException2, ForbiddenException } from '../common/api-exception';

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
}

const WRITE_ROLES = ['admin', 'operator', 'warehouse', 'supervisor', 'staff'];

export async function resolveUser(db: DbService, req: any): Promise<CurrentUser | null> {
  let token: string | null = null;
  const auth = req.headers?.authorization ?? req.query?.token;
  if (auth) {
    token = String(auth).startsWith('Bearer ') ? String(auth).slice(7) : String(auth);
  }
  if (!token) return null;
  const r = await db.query<{
    id: number;
    username: string;
    full_name: string;
    email: string;
    role: string;
  }>(
    `SELECT u.id, u.username, u.full_name, u.email, u.role
     FROM auth_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token = $1 AND t.expires_at > NOW() LIMIT 1`,
    [token],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: Number(row.id),
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = await resolveUser(this.db, req);
    if (!user) throw new UnauthorizedException2('Unauthorized');
    req.user = user;
    return true;
  }
}

@Injectable()
export class WriteGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = await resolveUser(this.db, req);
    if (!user) throw new UnauthorizedException2('Unauthorized');
    if (!WRITE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Akses ditolak. Role Anda tidak memiliki izin untuk mengubah data.');
    }
    req.user = user;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = await resolveUser(this.db, req);
    if (!user) throw new UnauthorizedException2('Unauthorized');
    if (user.role !== 'admin') {
      throw new ForbiddenException('Akses ditolak. Khusus admin.');
    }
    req.user = user;
    return true;
  }
}
