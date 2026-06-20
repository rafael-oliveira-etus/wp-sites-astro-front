import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { type Tenant, tenantSchema } from './schemas';

// ── SSR enablement: BUILD-ONLY tenant loaders ───────────────────────────────────
// node:fs / process.cwd() live here, NOT in tenant.ts. Imported only by
// astro.config.ts (runs in Node). Never import this from a route or component
// (those evaluate in the workerd prerender sandbox).

export const TENANTS_DIR = resolve(process.cwd(), 'tenants');

export function loadTenant(id: string): Tenant {
  const path = join(TENANTS_DIR, id, 'tenant.yaml');
  const raw = readFileSync(path, 'utf8');
  const parsed = parse(raw);
  return tenantSchema.parse({ ...parsed, id });
}

export function tenantPublicDir(id: string): string {
  return join(TENANTS_DIR, id, 'public');
}

export function activeTenantIdFromEnv(): string {
  const id = process.env.TENANT_ID;
  if (!id) {
    throw new Error(
      'TENANT_ID env var is required. Run with `TENANT_ID=<id> pnpm build`.',
    );
  }
  return id;
}
