import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JobKind } from './types.js';
import { pathExists } from './harness/shared.js';

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'prompts');

export const TEMPLATE_FOR: Record<JobKind, string> = {
  build: 'issue-build',
  plan: 'plan',
  instruct: 'pr-instruction',
  'review-fix': 'review-fix',
};

/** Repo override `.factory/prompts/<name>.md` wins over the built-in template. */
async function loadTemplate(name: string, workspace: string): Promise<string> {
  const override = join(workspace, '.factory', 'prompts', `${name}.md`);
  if (await pathExists(override)) return readFile(override, 'utf8');
  return readFile(join(BUILTIN_DIR, `${name}.md`), 'utf8');
}

export function render(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v.trim() === '' ? '(none)' : v;
  });
}

export async function buildPrompt(kind: JobKind, workspace: string, vars: Record<string, string | undefined>): Promise<string> {
  const body = await loadTemplate(TEMPLATE_FOR[kind], workspace);
  const rules = kind === 'plan' ? '' : await loadTemplate('_rules', workspace);
  return render(body + rules, vars).trim() + '\n';
}
