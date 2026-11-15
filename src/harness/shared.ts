import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../fsutil.js';
import type { ResolvedSkill } from '../skills.js';

/** Copy skills into `<workspace>/<relDir>/<name>`, skipping names the repo already defines. */
export async function placeSkills(workspace: string, relDir: string, skills: ResolvedSkill[]): Promise<string[]> {
  const created: string[] = [];
  for (const s of skills) {
    const rel = `${relDir}/${s.name}`;
    const target = join(workspace, rel);
    if (await pathExists(target)) continue; // repo-local skill wins
    await mkdir(join(workspace, relDir), { recursive: true });
    await cp(s.dir, target, { recursive: true });
    created.push(rel);
  }
  return created;
}

/** If the repo has AGENTS.md but not `fileName`, create a shim that points the harness at AGENTS.md. */
export async function shimInstructions(workspace: string, fileName: string, content: string): Promise<string[]> {
  if (!(await pathExists(join(workspace, 'AGENTS.md')))) return [];
  if (await pathExists(join(workspace, fileName))) return [];
  await writeFile(join(workspace, fileName), content);
  return [fileName];
}
