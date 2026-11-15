import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Comment, GitHub, Issue, Pull, ReviewComment } from '../src/github.js';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

/** A bare "origin" seeded with `files` on main. Returns its file:// URL and path. */
export function makeOrigin(files: Record<string, string>): { url: string; bare: string } {
  const root = mkdtempSync(join(tmpdir(), 'factory-test-'));
  const seed = join(root, 'seed');
  const bare = join(root, 'origin.git');
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(seed, p)), { recursive: true });
    writeFileSync(join(seed, p), c);
  }
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(root, 'clone', '-q', '--bare', seed, bare);
  return { url: `file://${bare}`, bare };
}

export class FakeGitHub implements GitHub {
  comments: { n: number; body: string }[] = [];
  reactions: unknown[] = [];
  pulls: Pull[] = [];
  permissions: Record<string, string> = {};
  issues: Record<number, Issue> = {};

  async getIssue(n: number) {
    return this.issues[n] ?? { title: 'Add hello endpoint', body: 'Return hello world', author: 'giova333', isPullRequest: false };
  }
  async listIssueComments(_n: number): Promise<Comment[]> {
    return [{ author: 'giova333', body: 'please use plain JS', createdAt: '2026-11-15T00:00:00Z' }];
  }
  async getPull(n: number) {
    const p = this.pulls.find((x) => x.number === n);
    if (!p) throw new Error(`no PR ${n}`);
    return p;
  }
  async getPullDiff() {
    return 'diff --git a/x b/x';
  }
  async getReviewBody() {
    return 'Please add a test';
  }
  async listReviewComments(): Promise<ReviewComment[]> {
    return [{ author: 'giova333', path: 'hello.js', line: 1, body: 'name this greet' }];
  }
  async getPermission(user: string) {
    return this.permissions[user] ?? 'none';
  }
  async getDefaultBranch() {
    return 'main';
  }
  async reactEyes(t: unknown) {
    this.reactions.push(t);
  }
  async comment(n: number, body: string) {
    this.comments.push({ n, body });
  }
  async findOpenPullByHead(branch: string) {
    return this.pulls.find((p) => p.headRef === branch) ?? null;
  }
  async createDraftPull(p: { title: string; head: string; base: string; body: string }) {
    const pr: Pull = { number: 100 + this.pulls.length, title: p.title, body: p.body, headRef: p.head, headRepo: 'giova333/sandbox', baseRef: p.base, url: `https://github.com/giova333/sandbox/pull/${100 + this.pulls.length}` };
    this.pulls.push(pr);
    return pr;
  }
}
