import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface FactoryConfig {
  harness: string;
  model: string;
  /** If non-empty, only these GitHub logins may trigger the factory. Otherwise write/maintain/admin is required. */
  allowed_users: string[];
  /** Skill sources, pinned: github:<owner>/<repo>@<40-char sha>#<path> */
  skills: string[];
  setup?: string;
  test?: string;
  limits: {
    timeout_minutes: number;
    max_turns: number;
  };
}

export const DEFAULT_CONFIG: FactoryConfig = {
  harness: 'claude-code',
  model: 'claude-sonnet-5-5',
  allowed_users: [],
  skills: [],
  limits: { timeout_minutes: 30, max_turns: 60 },
};

export const CONFIG_FILE = '.factory.yml';

export function mergeConfig(raw: unknown): FactoryConfig {
  const r = (raw ?? {}) as Partial<FactoryConfig>;
  if (typeof r !== 'object' || Array.isArray(r)) throw new Error(`${CONFIG_FILE} must be a mapping`);
  const cfg: FactoryConfig = {
    ...DEFAULT_CONFIG,
    ...r,
    limits: { ...DEFAULT_CONFIG.limits, ...(r.limits ?? {}) },
  };
  if (!Array.isArray(cfg.allowed_users)) throw new Error('allowed_users must be a list');
  if (!Array.isArray(cfg.skills)) throw new Error('skills must be a list');
  for (const k of ['timeout_minutes', 'max_turns'] as const) {
    const v = cfg.limits[k];
    if (typeof v !== 'number' || !(v > 0)) throw new Error(`limits.${k} must be a positive number`);
  }
  return cfg;
}

export async function loadConfig(workspace: string): Promise<FactoryConfig> {
  let text: string;
  try {
    text = await readFile(join(workspace, CONFIG_FILE), 'utf8');
  } catch (e: any) {
    if (e.code === 'ENOENT') return mergeConfig({});
    throw e;
  }
  return mergeConfig(parse(text));
}
