#!/usr/bin/env node
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OctokitGitHub } from './github.js';
import { createHarness } from './harness/index.js';
import { runJob } from './pipeline.js';
import { parseEvent } from './triggers.js';
import type { Logger } from './types.js';

const USAGE = `Usage: factory run [--event <path>] [--event-name <name>] [--out <dir>]

Environment:
  GITHUB_EVENT_PATH, GITHUB_EVENT_NAME   event payload and name (defaults for --event/--event-name)
  FACTORY_GITHUB_TOKEN                   GitHub App installation token (push, PRs, comments)
  ANTHROPIC_API_KEY                      passed to the harness; nothing else secret is
  FACTORY_ALLOWED_USERS                  comma-separated hard allowlist (optional)
  FACTORY_GIT_NAME, FACTORY_GIT_EMAIL    commit identity
  FACTORY_RUN_URL                        link to this run, shown in replies
`;

const log: Logger = {
  info: (m) => console.log(`[factory] ${m}`),
  warn: (m) => console.warn(`[factory] WARN ${m}`),
};

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      event: { type: 'string' },
      'event-name': { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals[0] !== 'run') {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const eventPath = values.event ?? process.env.GITHUB_EVENT_PATH;
  const eventName = values['event-name'] ?? process.env.GITHUB_EVENT_NAME;
  if (!eventPath || !eventName) throw new Error('event path and name are required (see --help)');
  const payload = JSON.parse(await readFile(eventPath, 'utf8'));

  const parsed = parseEvent(eventName, payload);
  if ('skip' in parsed) {
    log.info(`skip: ${parsed.skip}`);
    return 0;
  }
  const job = parsed.job;
  log.info(`job ${job.kind} on ${job.repo.owner}/${job.repo.name}#${job.number} by @${job.actor}`);

  const token = process.env.FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error('FACTORY_GITHUB_TOKEN is not set');
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const workRoot = await mkdtemp(join(tmpdir(), 'factory-'));

  const outcome = await runJob(job, {
    gh: new OctokitGitHub(token, job.repo, process.env.GITHUB_API_URL),
    log,
    workRoot,
    outDir: values.out ?? join(workRoot, 'out'),
    repoUrl: `${server}/${job.repo.owner}/${job.repo.name}.git`,
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
