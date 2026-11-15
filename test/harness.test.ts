import { afterEach, describe, expect, it } from 'vitest';
import { exec, sandboxEnv } from '../src/exec.js';
import { FakeHarness } from '../src/harness/fake.js';
import { createHarness } from '../src/harness/index.js';

afterEach(() => {
  delete process.env.FACTORY_ENABLE_FAKE_HARNESS;
  delete process.env.FACTORY_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.OPENAI_API_KEY;
});

describe('createHarness', () => {
  it('refuses the fake harness unless FACTORY_ENABLE_FAKE_HARNESS=1', () => {
    expect(() => createHarness('fake')).toThrow(/disabled/);
    process.env.FACTORY_ENABLE_FAKE_HARNESS = '1';
    expect(createHarness('fake')).toBeInstanceOf(FakeHarness);
  });
});

describe('child process environments', () => {
  it('exec does not pass GitHub tokens to children by default', async () => {
    process.env.FACTORY_GITHUB_TOKEN = 'secret-token';
    process.env.GITHUB_TOKEN = 'secret-token';
    const { stdout } = await exec('env', []);
    expect(stdout).not.toContain('secret-token');
  });
  it('sandboxEnv carries the Anthropic key only', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    expect(sandboxEnv()).not.toHaveProperty('OPENAI_API_KEY');
  });
});
