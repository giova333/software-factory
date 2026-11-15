import { BRANCH_PREFIX, type ParseResult, type RepoRef } from './types.js';

export const FACTORY_LABEL = 'factory';
export const COMMAND = '/factory';

export interface ParsedCommand {
  verb: 'build' | 'plan' | 'text';
  text: string;
  harness?: string;
  model?: string;
}

/**
 * Parse a `/factory ...` comment. Returns null when the comment is not a factory command.
 * Grammar: /factory [--harness <name>] [--model <id>] [build|plan|<free text>]
 */
export function parseCommand(body: string | null | undefined): ParsedCommand | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (!(trimmed === COMMAND || trimmed.startsWith(COMMAND + ' ') || trimmed.startsWith(COMMAND + '\n'))) {
    return null;
  }
  let rest = trimmed.slice(COMMAND.length).trim();
  const out: ParsedCommand = { verb: 'text', text: '' };
  for (;;) {
    const m = rest.match(/^--(harness|model)(?:=|\s+)(\S+)\s*/);
    if (!m) break;
    if (m[1] === 'harness') out.harness = m[2];
    else out.model = m[2];
    rest = rest.slice(m[0].length);
  }
  const firstWord = rest.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (rest === '' || firstWord === 'build') {
    out.verb = 'build';
    out.text = rest.slice(firstWord.length).trim();
  } else if (firstWord === 'plan') {
    out.verb = 'plan';
    out.text = rest.slice(firstWord.length).trim();
  } else {
    out.text = rest;
  }
  return out;
}

function repoOf(payload: any): RepoRef {
  return { owner: payload.repository.owner.login, name: payload.repository.name };
}

function isBot(user: any): boolean {
  return user?.type === 'Bot' || String(user?.login ?? '').endsWith('[bot]');
}

/** Turn a GitHub webhook event into a Job, or explain why it is skipped. */
export function parseEvent(eventName: string, payload: any): ParseResult {
  switch (eventName) {
    case 'issues': {
      if (payload.action !== 'labeled') return { skip: `issues.${payload.action} is not a trigger` };
      if (payload.label?.name !== FACTORY_LABEL) return { skip: `label "${payload.label?.name}" is not "${FACTORY_LABEL}"` };
      if (payload.issue?.pull_request) return { skip: 'label on a pull request is not a trigger' };
      return {
        job: {
          kind: 'build',
          repo: repoOf(payload),
          number: payload.issue.number,
          isPullRequest: false,
          actor: payload.sender.login,
        },
      };
    }

    case 'issue_comment': {
      if (payload.action !== 'created') return { skip: `issue_comment.${payload.action} is not a trigger` };
      if (isBot(payload.comment.user)) return { skip: 'comments from bots are ignored' };
      const cmd = parseCommand(payload.comment.body);
      if (!cmd) return { skip: 'comment is not a /factory command' };
      const isPr = Boolean(payload.issue.pull_request);
      const base = {
        repo: repoOf(payload),
        number: payload.issue.number,
        isPullRequest: isPr,
        actor: payload.comment.user.login,
        commentId: payload.comment.id,
        harness: cmd.harness,
        model: cmd.model,
      };
      if (cmd.verb === 'plan') return { job: { ...base, kind: 'plan', instruction: cmd.text || undefined } };
      if (!isPr) return { job: { ...base, kind: 'build', instruction: cmd.text || undefined } };
      if (!cmd.text) return { skip: 'a /factory comment on a PR needs an instruction' };
      return { job: { ...base, kind: 'instruct', instruction: cmd.text } };
    }

    case 'pull_request_review': {
      if (payload.action !== 'submitted') return { skip: `pull_request_review.${payload.action} is not a trigger` };
      if (payload.review?.state !== 'changes_requested') return { skip: `review state "${payload.review?.state}" is not changes_requested` };
      const head: string = payload.pull_request.head.ref;
      if (!head.startsWith(BRANCH_PREFIX)) return { skip: `PR branch "${head}" is not a factory branch` };
      if (isBot(payload.review.user)) return { skip: 'reviews from bots are ignored' };
      return {
        job: {
          kind: 'review-fix',
          repo: repoOf(payload),
          number: payload.pull_request.number,
          isPullRequest: true,
          actor: payload.review.user.login,
          reviewId: payload.review.id,
        },
      };
    }

    default:
      return { skip: `event "${eventName}" is not a trigger` };
  }
}
