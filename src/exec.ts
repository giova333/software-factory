import { spawn } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  timeoutMs?: number;
  /** Throw on non-zero exit (default true). */
  check?: boolean;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Environment variables that hold GitHub credentials. No child process of the factory inherits them. */
const TOKEN_VARS = ['FACTORY_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];

/** The factory's own environment minus GitHub tokens: the default for every child process. */
export function hostEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of TOKEN_VARS) delete env[k];
  return env;
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: (opts.env ?? hostEnv()) as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
          killTimer.unref();
        }, opts.timeoutMs)
      : undefined;
    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    // A child that exits without reading its input makes the stdin write fail with EPIPE.
    // Without a listener that surfaces as an unhandled 'error' event; the exit code already tells the story.
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      clearTimers();
      reject(e);
    });
    child.on('close', (code) => {
      clearTimers();
      const res = { code: code ?? -1, stdout, stderr, timedOut };
      if ((opts.check ?? true) && res.code !== 0) {
        reject(new Error(`${cmd} ${args.join(' ')} exited ${res.code}${timedOut ? ' (timeout)' : ''}\n${stderr.slice(-4000)}`));
      } else {
        resolve(res);
      }
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Run a shell command line (used for repo-defined setup/test commands). */
export function sh(line: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return exec('bash', ['-lc', line], { check: false, ...opts });
}

/**
 * The only environment a harness or repo command ever sees.
 * GitHub tokens are deliberately absent: the factory process does every push and API call.
 */
export function sandboxEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const pass = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER', 'SHELL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'];
  const env: Record<string, string> = {};
  for (const k of pass) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  env.CI = 'true';
  return env;
}
