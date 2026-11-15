import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from './exec.js';

export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Git operations run by the factory process only. The token is passed per network command
 * via an http extraheader and is never written to .git/config, so the harness cannot use it.
 */
export class Git {
  constructor(
    readonly dir: string,
    private readonly remoteUrl: string,
    private readonly token: string | undefined,
    private readonly identity: GitIdentity,
  ) {}

  private authArgs(): string[] {
    if (!this.token || !this.remoteUrl.startsWith('https://')) return [];
    const basic = Buffer.from(`x-access-token:${this.token}`).toString('base64');
    const host = new URL(this.remoteUrl).origin;
    return ['-c', `http.${host}/.extraheader=AUTHORIZATION: basic ${basic}`];
  }

  private git(args: string[], opts: { network?: boolean; check?: boolean } = {}) {
    const pre = opts.network ? this.authArgs() : [];
    return exec('git', [...pre, ...args], {
      cwd: this.dir,
      check: opts.check,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }

  async clone(baseBranch: string): Promise<void> {
    await exec('git', ['init', '-q', '-b', baseBranch, this.dir]);
    await this.git(['remote', 'add', 'origin', this.remoteUrl]);
    await this.git(['fetch', '-q', 'origin', baseBranch], { network: true });
    await this.git(['checkout', '-q', '-B', baseBranch, `origin/${baseBranch}`]);
    await this.git(['config', 'user.name', this.identity.name]);
    await this.git(['config', 'user.email', this.identity.email]);
  }

  /** Check out `branch`, continuing from the remote copy if it exists, else branching off `from`. */
  async checkoutWorkBranch(branch: string, from: string): Promise<'existing' | 'new'> {
    const res = await this.git(['fetch', '-q', 'origin', `${branch}:refs/remotes/origin/${branch}`], { network: true, check: false });
    if (res.code === 0) {
      await this.git(['checkout', '-q', '-B', branch, `origin/${branch}`]);
      return 'existing';
    }
    await this.git(['checkout', '-q', '-B', branch, `origin/${from}`]);
    return 'new';
  }

  /** Keep factory-injected files (skills, CLAUDE.md shim) out of commits. */
  async exclude(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await appendFile(join(this.dir, '.git', 'info', 'exclude'), paths.map((p) => `/${p}`).join('\n') + '\n');
  }

  async head(): Promise<string> {
    return (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
  }

  async hasUncommitted(): Promise<boolean> {
    return (await this.git(['status', '--porcelain'])).stdout.trim() !== '';
  }

  async commitAll(message: string): Promise<void> {
    await this.git(['add', '-A']);
    await this.git(['commit', '-q', '-m', message]);
  }

  async push(branch: string): Promise<void> {
    await this.git(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { network: true });
  }

  async diffStat(fromSha: string): Promise<string> {
    return (await this.git(['diff', '--stat', `${fromSha}..HEAD`])).stdout.trim();
  }
}
