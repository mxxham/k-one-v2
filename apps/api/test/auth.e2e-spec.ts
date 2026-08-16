import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, appRequest, resetDb } from './helpers';

describe('Auth + gateway', () => {
  beforeAll(async () => {
    await getTestApp();
    await resetDb();
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('rejects requests without a token', async () => {
    const res = await appRequest().post('/index.php').query({ module: 'putaway', action: 'zones' }).send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('logs in with seeded testadmin and returns a token', async () => {
    const res = await appRequest().post('/index.php').query({ module: 'auth', action: 'login' }).send({ username: 'testadmin', password: 'admin123' });
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.username).toBe('testadmin');
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects wrong password', async () => {
    const res = await appRequest().post('/index.php').query({ module: 'auth', action: 'login' }).send({ username: 'testadmin', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown module', async () => {
    const token = await login();
    const res = await appRequest().post('/index.php').query({ module: 'nope', action: 'x' }).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(404);
  });
});