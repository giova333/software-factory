import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeHarness } from '../src/harness/fake.js';
import { createHarness } from '../src/harness/index.js';
import { runJob, type PipelineDeps } from '../src/pipeline.js';
import type { Job } from '../src/types.js';
import { FakeGitHub, git, makeOrigin } from './helpers.js';

const quiet = { info: () => {}, warn: () => {} };
const repo = { owner: 'giova333', name: 'sandbox' };

function deps(gh: FakeGitHub, url: string, harness = new FakeHarness(), extra: Partial<PipelineDeps> = {}): PipelineDeps {
  const workRoot = mkdtempSync(join(tmpdir(), 'factory-run-'));
  return {
    gh,
    log: quiet,
    workRoot,
    outDir: join(workRoot, 'out'),
    repoUrl: url,
    identity: { name: 'factory-bot', email: 'bot@example.com' },
    createHarness: () => harness,
    runUrl: 'https://github.com/giova333/sandbox/actions/runs/1',
    ...extra,
  };
}

const ALLOW = '.factory.yml';
const allowMe = 'allowed_users: [giova333]\nharness: fake\n';

describe('runJob', () => {
  it('builds an issue: pushes a factory branch, opens a draft PR, replies on the issue', async () => {
    const { url, bare } = makeOrigin({ [ALLOW]: allowMe, 'README.md': '# sandbox\n' });
    const gh = new FakeGitHub();
    const harness = new FakeHarness();
    const job: Job = { kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' };

    const out = await runJob(job, deps(gh, url, harness));

    expect(out.status).toBe('pushed');
    expect(gh.pulls).toHaveLength(1);
    expect(gh.pulls[0]).toMatchObject({ headRef: 'factory/1-add-hello-endpoint', baseRef: 'main' });
    expect(gh.pulls[0]!.body).toContain('Closes #1');
    expect(git(bare, 'log', '--format=%an %s', '-1', 'factory/1-add-hello-endpoint')).toBe('factory-bot factory: Add hello endpoint (#1)');
    expect(gh.reactions).toEqual([{ issueNumber: 1 }]);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]!.body).toContain('Pull request: https://github.com/giova333/sandbox/pull/100');
    // The prompt carries the issue and the discussion
    expect(harness.calls[0]!.prompt).toContain('Implement GitHub issue #1: Add hello endpoint');
    expect(harness.calls[0]!.prompt).toContain('please use plain JS');
  });

  it('never hands GitHub credentials to the harness', async () => {
    const { url } = makeOrigin({ [ALLOW]: allowMe });
    const harness = new FakeHarness();
    process.env.FACTORY_GITHUB_TOKEN = 'secret-token';
    process.env.GITHUB_TOKEN = 'secret-token';
    try {
      await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(new FakeGitHub(), url, harness));
    } finally {
      delete process.env.FACTORY_GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
    }
    const env = harness.calls[0]!.env;
    expect(Object.values(env)).not.toContain('secret-token');
  });

  it('re-running the same issue reuses the branch and the PR', async () => {
    const { url, bare } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    const job: Job = { kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' };
    await runJob(job, deps(gh, url));
    await runJob(job, deps(gh, url));
    expect(gh.pulls).toHaveLength(1);
    expect(git(bare, 'rev-list', '--count', 'factory/1-add-hello-endpoint')).toBe('3');
  });

  it('silently skips users outside the allowlist', async () => {
    const { url, bare } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    const out = await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'stranger' }, deps(gh, url));
    expect(out.status).toBe('unauthorized');
    expect(gh.comments).toEqual([]);
    expect(gh.reactions).toEqual([]);
    expect(git(bare, 'branch', '--list', 'factory/*')).toBe('');
  });

  it('the workflow allowlist overrides .factory.yml', async () => {
    const { url } = makeOrigin({ [ALLOW]: 'allowed_users: [stranger]\n' });
    const out = await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'stranger' }, deps(new FakeGitHub(), url, undefined, { allowedUsers: ['giova333'] }));
    expect(out.status).toBe('unauthorized');
  });

  it('without an allowlist, write permission is required', async () => {
    const { url } = makeOrigin({ 'README.md': 'x' });
    const gh = new FakeGitHub();
    gh.permissions = { writer: 'write', reader: 'read' };
    expect((await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'reader' }, deps(gh, url))).status).toBe('unauthorized');
    expect((await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'writer' }, deps(gh, url))).status).toBe('pushed');
  });

  it('a PR instruction commits to the existing PR branch', async () => {
    const { url, bare } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url));
    const pr = gh.pulls[0]!;
    const harness = new FakeHarness();
    const out = await runJob({ kind: 'instruct', repo, number: pr.number, isPullRequest: true, actor: 'giova333', instruction: 'rename to greet', commentId: 5 }, deps(gh, url, harness));
    expect(out.status).toBe('pushed');
    expect(gh.pulls).toHaveLength(1);
    expect(git(bare, 'rev-list', '--count', pr.headRef)).toBe('3');
    expect(harness.calls[0]!.prompt).toContain('rename to greet');
    expect(gh.reactions.at(-1)).toEqual({ commentId: 5 });
  });

  it('review-fix includes review comments in the prompt', async () => {
    const { url } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url));
    const harness = new FakeHarness();
    await runJob({ kind: 'review-fix', repo, number: gh.pulls[0]!.number, isPullRequest: true, actor: 'giova333', reviewId: 9 }, deps(gh, url, harness));
    expect(harness.calls[0]!.prompt).toContain('`hello.js:1` (@giova333): name this greet');
    expect(harness.calls[0]!.prompt).toContain('Please add a test');
  });

  it('refuses PRs from forks', async () => {
    const { url } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    gh.pulls.push({ number: 9, title: 't', body: '', headRef: 'factory/x', headRepo: 'evil/sandbox', baseRef: 'main', url: 'u' });
    const out = await runJob({ kind: 'instruct', repo, number: 9, isPullRequest: true, actor: 'giova333', instruction: 'x' }, deps(gh, url));
    expect(out.status).toBe('failed');
    expect(gh.comments[0]!.body).toContain('fork');
  });

  it('plan posts a comment and pushes nothing', async () => {
    const { url, bare } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    const out = await runJob({ kind: 'plan', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url, new FakeHarness({ edit: false, summary: 'The plan' })));
    expect(out.status).toBe('planned');
    expect(gh.comments[0]!.body).toContain('The plan');
    expect(git(bare, 'branch', '--list', 'factory/*')).toBe('');
  });

  it('reports no-changes when the agent edits nothing', async () => {
    const { url } = makeOrigin({ [ALLOW]: allowMe });
    const gh = new FakeGitHub();
    const out = await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url, new FakeHarness({ edit: false })));
    expect(out.status).toBe('no-changes');
    expect(gh.pulls).toEqual([]);
    expect(gh.comments[0]!.body).toContain('No changes were made.');
  });

  it('runs setup and test commands and reports test failures', async () => {
    const { url } = makeOrigin({ [ALLOW]: allowMe + 'setup: echo setup > .setup-ran\ntest: "echo boom; exit 3"\n', '.gitignore': '.setup-ran\n' });
    const gh = new FakeGitHub();
    const out = await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url));
    expect(out.status).toBe('pushed');
    expect(gh.comments[0]!.body).toContain('Tests: failed (exit 3).');
    expect(gh.comments[0]!.body).toContain('boom');
  });

  it('reports an unavailable harness as a failed run', async () => {
    const { url } = makeOrigin({ [ALLOW]: 'allowed_users: [giova333]\nharness: codex\n' });
    const gh = new FakeGitHub();
    const out = await runJob({ kind: 'build', repo, number: 1, isPullRequest: false, actor: 'giova333' }, deps(gh, url, undefined, { createHarness }));
    expect(out.status).toBe('failed');
    expect(gh.comments[0]!.body).toContain('planned for v1.1');
  });
});
