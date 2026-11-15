import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec, hostEnv } from './exec.js';

export interface GitIdentity {
  name: string;
  email: string;
}

/**
 * Git operations run by the factory process only. The token is passed per network command
 * via an http extraheader and is never written to .git/config, so the harness cannot use it.
 *
 * The harness can write anything under .git, so every command:
 * - runs with an environment that has no GitHub token in it;
 * - disables hooks and fsmonitor, so a planted `.git/hooks/*` or `core.fsmonitor` never runs
 *   (git exports `-c` options, including the auth header, to hooks via GIT_CONFIG_PARAMETERS);
 * - fetches from and pushes to `remoteUrl` directly, so a rewritten `origin` (url, pushurl,
 *   insteadOf) cannot redirect the push. The auth header stays scoped to that URL's origin.
 *   `url.*.insteadOf` applies even to explicit URLs, and repo config can define filters and
 *   drivers that git runs, so `.git/config` is restored to the copy taken at clone time before
 *   every command.
 */
export class Git {
  constructor(
    readonly dir: string,
    private readonly remoteUrl: string,
    private readonly token: string | undefined,
    private readonly identity: GitIdentity,
  ) {}

  /** `.git/config` as the factory left it after cloning. */
  private config?: string;

  private async restoreConfig(): Promise<void> {
    if (this.config !== undefined) await writeFile(join(this.dir, '.git', 'config'), this.config);
  }

  private authArgs(): string[] {
    if (!this.token || !this.remoteUrl.startsWith('https://')) return [];
    const basic = Buffer.from(`x-access-token:${this.token}`).toString('base64');
    const host = new URL(this.remoteUrl).origin;
    return ['-c', `http.${host}/.extraheader=AUTHORIZATION: basic ${basic}`];
  }

  private async git(args: string[], opts: { network?: boolean; check?: boolean } = {}) {
    await this.restoreConfig();
    const safety = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
    const auth = opts.network ? this.authArgs() : [];
    return exec('git', [...safety, ...auth, ...args], {
      cwd: this.dir,
      check: opts.check,
      env: { ...hostEnv(), GIT_TERMINAL_PROMPT: '0' },
    });
  }

  async clone(baseBranch: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.git(['init', '-q', '-b', baseBranch]);
    // `origin` is kept for the agent's convenience (e.g. `git diff origin/main`); the factory never uses it for network commands.
    await this.git(['remote', 'add', 'origin', this.remoteUrl]);
    await this.git(['fetch', '-q', this.remoteUrl, `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`], { network: true });
    await this.git(['checkout', '-q', '-B', baseBranch, `origin/${baseBranch}`]);
    await this.git(['config', 'user.name', this.identity.name]);
    await this.git(['config', 'user.email', this.identity.email]);
    this.config = await readFile(join(this.dir, '.git', 'config'), 'utf8');
  }

  /** Check out `branch`, continuing from the remote copy if it exists, else branching off `from`. */
  async checkoutWorkBranch(branch: string, from: string): Promise<'existing' | 'new'> {
    const res = await this.git(['fetch', '-q', this.remoteUrl, `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { network: true, check: false });
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
    await this.git(['push', '-q', this.remoteUrl, `HEAD:refs/heads/${branch}`], { network: true });
  }

  async diffStat(fromSha: string): Promise<string> {
    return (await this.git(['diff', '--stat', `${fromSha}..HEAD`])).stdout.trim();
  }
}
