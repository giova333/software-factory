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

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
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
  const pass = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER', 'SHELL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY'];
  const env: Record<string, string> = {};
  for (const k of pass) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  env.CI = 'true';
  return env;
}
