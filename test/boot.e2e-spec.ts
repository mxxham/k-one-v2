import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp } from './helpers';

describe('Boot smoke', () => {
  beforeAll(async () => {
    await getTestApp();
  });
  afterAll(async () => {
    await closeTestApp();
  });
  it('boots', () => {
    expect(true).toBe(true);
  });
});