import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';

describe('mergeConfig', () => {
  it('fills defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig({ limits: { max_turns: 5 } }).limits).toEqual({ timeout_minutes: 30, max_turns: 5 });
  });
  it.each([
    ['a scalar', 'harness: fake', /must be a mapping/],
    ['a list', ['a'], /must be a mapping/],
    ['allowed_users as a string', { allowed_users: 'giova333' }, /allowed_users must be a list/],
    ['skills as a string', { skills: 'github:a/b@x' }, /skills must be a list/],
    ['a zero timeout', { limits: { timeout_minutes: 0 } }, /limits.timeout_minutes must be a positive number/],
    ['a string max_turns', { limits: { max_turns: '10' } }, /limits.max_turns must be a positive number/],
  ])('rejects %s', (_, raw, msg) => {
    expect(() => mergeConfig(raw)).toThrow(msg);
  });
});
