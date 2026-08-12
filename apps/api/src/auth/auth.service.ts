import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DbService } from '../database/db.service';
import { ActivityLogger } from '../common/activity-logger';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly activity: ActivityLogger,
  ) {}

  /** Issue opaque 64-hex token stored in auth_tokens with 12h TTL (matches PHP). */
  async issueToken(userId: number): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.db.query(
      `INSERT INTO auth_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '12 hours')`,
      [userId, token],
    );
    return token;
  }

  async revokeToken(req: any): Promise<void> {
    const auth = req.headers?.authorization ?? '';
    let token: string | null = null;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      token = auth.slice(7);
    }
    if (!token) return;
    await this.db.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
  }
}
