import { cp, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exec } from './exec.js';
import { pathExists } from './fsutil.js';
import type { Logger } from './types.js';

export interface SkillSource {
  raw: string;
  owner: string;
  repo: string;
  sha: string;
  path: string;
}

const SOURCE_RE = /^github:([\w.-]+)\/([\w.-]+)@([0-9a-f]{40})(?:#(.+))?$/;

/** Parse `github:<owner>/<repo>@<40-char sha>#<path>`. Moving refs (branches, tags, short SHAs) are rejected. */
export function parseSkillSource(raw: string): SkillSource {
  const m = raw.trim().match(SOURCE_RE);
  if (!m) {
    throw new Error(
      `Invalid skill source "${raw}". Expected github:<owner>/<repo>@<40-char commit sha>#<path>; branches and tags are not allowed.`,
    );
  }
  const path = (m[4] ?? '').replace(/^\/+|\/+$/g, '');
  if (path.split('/').includes('..')) throw new Error(`Skill path may not contain "..": ${raw}`);
  return { raw, owner: m[1]!, repo: m[2]!, sha: m[3]!, path };
}

/** Every directory under `root` (inclusive) that contains a SKILL.md. */
export async function findSkillDirs(root: string): Promise<string[]> {
  if (await pathExists(join(root, 'SKILL.md'))) return [root];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) out.push(...(await findSkillDirs(join(root, entry.name))));
  }
  return out;
}

export interface ResolvedSkill {
  name: string;
  source: string;
  dir: string;
}

/**
 * Fetch each pinned source at its exact commit and copy its skill folders into `destDir/<skill-name>`.
 * `fetchUrl` is injectable so tests can point at a local repo.
 */
export async function resolveSkills(
  sources: string[],
  destDir: string,
  workDir: string,
  log: Logger,
  fetchUrl: (s: SkillSource) => string = (s) => `https://github.com/${s.owner}/${s.repo}.git`,
): Promise<ResolvedSkill[]> {
  await mkdir(destDir, { recursive: true });
  const resolved: ResolvedSkill[] = [];
  for (const [i, raw] of sources.entries()) {
    const src = parseSkillSource(raw);
    const checkout = join(workDir, `skill-src-${i}`);
    await exec('git', ['init', '-q', checkout]);
    await exec('git', ['-C', checkout, 'fetch', '-q', '--depth', '1', fetchUrl(src), src.sha]);
    await exec('git', ['-C', checkout, 'checkout', '-q', 'FETCH_HEAD']);
    const root = join(checkout, src.path);
    if (!(await pathExists(root))) throw new Error(`Skill path "${src.path}" not found in ${src.owner}/${src.repo}@${src.sha}`);
    const dirs = await findSkillDirs(root);
    if (dirs.length === 0) throw new Error(`No SKILL.md found under ${raw}`);
    for (const dir of dirs) {
      const name = basename(dir);
      if (resolved.some((r) => r.name === name)) throw new Error(`Duplicate skill name "${name}" (from ${raw})`);
      const target = join(destDir, name);
      await cp(dir, target, { recursive: true });
      resolved.push({ name, source: raw, dir: target });
      log.info(`skill ${name} <- ${src.owner}/${src.repo}@${src.sha}${src.path ? '#' + src.path : ''}`);
    }
  }
  return resolved;
}
