#!/usr/bin/env node
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OctokitGitHub } from './github.js';
import { createHarness } from './harness/index.js';
import { runJob } from './pipeline.js';
import { parseEvent } from './triggers.js';
import { repoFullName, type Logger } from './types.js';

const USAGE = `Usage: factory run [--event <path>] [--event-name <name>] [--server-url <url>] [--api-url <url>]
                   [--token-stdin] [--out <dir>]

  --event, --event-name   event payload file and event name (e.g. issues, issue_comment)
  --server-url            git server, default https://github.com
  --api-url               GitHub API base URL, default Octokit's (https://api.github.com)
  --token-stdin           read the GitHub App installation token from stdin. Use this in production:
                          a token in the environment is readable from /proc/<pid>/environ by the agent.
  --out                   where prompt.md, transcript.txt and run.json go

Environment:
  FACTORY_EVENT_PATH, FACTORY_EVENT_NAME   defaults for --event / --event-name
  FACTORY_SERVER_URL, FACTORY_API_URL      defaults for --server-url / --api-url
  FACTORY_GITHUB_TOKEN                     token fallback for local development (prefer --token-stdin)
  ANTHROPIC_API_KEY                        passed to the harness; nothing else secret is
  FACTORY_ALLOWED_USERS                    comma-separated hard allowlist (optional)
  FACTORY_GIT_NAME, FACTORY_GIT_EMAIL      commit identity
  FACTORY_RUN_URL                          link to this run, shown in replies
  FACTORY_ENABLE_FAKE_HARNESS=1            allow the scripted "fake" harness (dry runs)
`;

const log: Logger = {
  info: (m) => console.log(`[factory] ${m}`),
  warn: (m) => console.warn(`[factory] WARN ${m}`),
};

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function readToken(fromStdin: boolean | undefined): Promise<string | undefined> {
  const token = fromStdin ? (await readStdin()).trim() : process.env.FACTORY_GITHUB_TOKEN;
  // Either way, keep it out of the environment that child processes inherit.
  delete process.env.FACTORY_GITHUB_TOKEN;
  return token || undefined;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      event: { type: 'string' },
      'event-name': { type: 'string' },
      'server-url': { type: 'string' },
      'api-url': { type: 'string' },
      'token-stdin': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals[0] !== 'run') {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  // Read the token first so it leaves the environment even when the event is skipped.
  const token = await readToken(values['token-stdin']);

  const eventPath = values.event ?? process.env.FACTORY_EVENT_PATH;
  const eventName = values['event-name'] ?? process.env.FACTORY_EVENT_NAME;
  if (!eventPath || !eventName) throw new Error('event path and name are required (see --help)');
  const payload = JSON.parse(await readFile(eventPath, 'utf8'));

  const parsed = parseEvent(eventName, payload);
  if ('skip' in parsed) {
    log.info(`skip: ${parsed.skip}`);
    return 0;
  }
  const job = parsed.job;
  log.info(`job ${job.kind} on ${repoFullName(job.repo)}#${job.number} by @${job.actor}`);

  if (!token) throw new Error(values['token-stdin'] ? 'no token on stdin' : 'no token: pass --token-stdin or set FACTORY_GITHUB_TOKEN');
  const server = (values['server-url'] ?? process.env.FACTORY_SERVER_URL ?? 'https://github.com').replace(/\/+$/, '');
  const apiUrl = values['api-url'] ?? process.env.FACTORY_API_URL;
  const workRoot = await mkdtemp(join(tmpdir(), 'factory-'));

  const outcome = await runJob(job, {
    gh: new OctokitGitHub(token, job.repo, apiUrl),
    log,
    workRoot,
    outDir: values.out ?? join(workRoot, 'out'),
    repoUrl: `${server}/${repoFullName(job.repo)}.git`,
    token,
    identity: {
      name: process.env.FACTORY_GIT_NAME ?? 'software-factory',
      email: process.env.FACTORY_GIT_EMAIL ?? 'software-factory@users.noreply.github.com',
    },
    createHarness,
    runUrl: process.env.FACTORY_RUN_URL,
    allowedUsers: process.env.FACTORY_ALLOWED_USERS?.split(',').map((s) => s.trim()).filter(Boolean),
  });
  log.info(`outcome: ${outcome.status}${outcome.pr ? ` ${outcome.pr.url}` : ''}`);
  return outcome.status === 'failed' ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[factory] ERROR ${e?.stack ?? e}`);
    process.exit(1);
  },
);
