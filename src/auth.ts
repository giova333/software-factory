import type { FactoryConfig } from './config.js';
import type { GitHub } from './github.js';

const WRITE_LEVELS = new Set(['admin', 'maintain', 'write']);

/**
 * POC: when `allowed_users` is set, only those logins may trigger runs.
 * Otherwise the actor needs write, maintain or admin permission on the repo.
 */
export async function isAuthorized(actor: string, cfg: FactoryConfig, gh: GitHub): Promise<boolean> {
  if (cfg.allowed_users.length > 0) {
    return cfg.allowed_users.some((u) => u.toLowerCase() === actor.toLowerCase());
  }
  return WRITE_LEVELS.has(await gh.getPermission(actor));
}
