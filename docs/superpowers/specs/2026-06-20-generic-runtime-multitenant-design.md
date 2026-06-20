# Design — Worker genérico multi-tenant (resolução por Host em runtime)

**Data:** 2026-06-20
**Projeto:** etus-wp-sites-astro-front

## Objetivo

Trocar o modelo atual (**um build/worker por site**, com o tenant fixado em build via `TENANT_ID` e assado em `import.meta.env.TENANT_JSON`) por **um único worker genérico** que resolve o tenant em **runtime pelo Host** da requisição. Se o Host casa com o domínio (ou subdomínio) de um site cadastrado, carrega aquele tenant; senão, **404**.

## Decisões (do usuário)

- Config de todos os sites num **arquivo único** (`sites.config.ts`).
- Host desconhecido ⇒ **404**.
- Auth do WP por site via secret **`WP_AUTH_<ID>`**.
- **Sitemap é servido pela origem (WP)** — o front não gera sitemap.
- Escopo inclui a **virada de deploy** (1 worker + rotas de todos os domínios; aposentar `sites.manifest.json` + `gen-wrangler.mjs`).

## Contexto (estado atual relevante)

- Nenhuma página usa `prerender = true` → tudo já é SSR (viabiliza multi-tenant em runtime).
- Libs já são parametrizadas por tenant: `siteOrigin(tenant)`, `localeDisplay(tenant, …)`, `absoluteUrl(tenant, …)`. Só **11 arquivos `.astro`** importam o `TENANT` constante.
- `wp-runtime.ts` lê bindings em runtime via `cloudflare:workers`; o WP client é parametrizado por `baseUrl` (cada tenant tem o seu `blog.wpBaseUrl`).
- Chave do cache WP = a **URL completa** (`key: url`) → já isola por tenant (domínios diferentes ⇒ chaves diferentes). Sem trabalho extra.
- Único acoplamento single-origin de build: `@astrojs/sitemap` (usa `site`).

## Arquitetura

### 1. Config consolidada — `sites.config.ts`
- Exporta `SITES: Record<TenantId, Tenant>` (cada entrada validada por `tenantSchema`).
- Exporta `resolveTenantByHost(host: string): Tenant | null`:
  - normaliza host (lowercase, remove porta);
  - retorna o site cujo `domains[]` contém `d` tal que `host === d || host.endsWith('.' + d)` (match por sufixo — cobre `www.` e subdomínios; evita falso-positivo de "contains").
- Substitui `tenants/<id>/tenant.yaml`. O `tenant.yaml` do limitemais vira a primeira entrada de `SITES`.

### 2. Resolução por request — `middleware.ts`
- Lê o `Host` (`req.headers.get('host')`), chama `resolveTenantByHost`.
- `null` ⇒ responde **404** (Response 404 / rewrite `/404`).
- encontrado ⇒ `context.locals.tenant = tenant` (mantém a lógica atual de nonce/device/country).
- **Dev fallback:** quando `import.meta.env.DEV` e o host não casa (ex.: `localhost`), resolve via `process.env.TENANT_ID` (default: único/primeiro site). Mantém `pnpm dev`/preview em localhost.

### 3. TENANT por request
- `env.d.ts`: adicionar `tenant: import('./lib/schemas').Tenant` em `App.Locals`.
- Nos 11 `.astro` (`BaseHead`, `Header`, `BaseLayout`, `BlogLayout`, `index`, `[...slug]`, `404`, `AnalyticsBoot`, `ConsentBanner`, `PixelsLoader`, `TurnstileWidget`): trocar `import { TENANT } from '…/tenant'` por `const TENANT = Astro.locals.tenant;` no frontmatter. O resto (`TENANT.x`) não muda.
- `tenant.ts`: remover o `TENANT` const, `activeTenantId()` e a leitura de `TENANT_JSON`. Manter os helpers param-based.

### 4. `astro.config.ts` genérico
- Remover baking por-tenant: `TENANT_ID`, `TENANT_JSON`, `TENANT_LOGO_SVG`, `loadTenant`, import de `tenant.build`, e as entradas `vite.define` correspondentes.
- Remover `site` (URLs absolutas vêm de `siteOrigin(tenant)` em runtime).
- Remover a integração `@astrojs/sitemap`.
- Remover/neutralizar `i18n` (permalinks flat; o locale vem de `tenant.defaultLocale`, não do roteamento i18n do Astro). Verificar `Astro.currentLocale` na implementação.
- `publicDir: './public'` (compartilhado).
- `trailingSlash: 'ignore'` (todos headless).

### 5. Eliminar a pasta `tenants/`
- Config → `sites.config.ts`.
- `_headers` / `_redirects` → `./public/` (1 worker = 1 conjunto de assets).
- Remover `src/lib/tenant.build.ts`.

### 6. WP runtime por-tenant — `wp-runtime.ts`
- `WP_CACHE`: sem mudança (chave por URL já isola).
- `WP_AUTH`: `wpDepsFromRuntime(baseUrl, tenantId)` lê `env['WP_AUTH_' + tenantId.toUpperCase()]` (ex.: `WP_AUTH_LIMITEMAIS`), com fallback `process.env['WP_AUTH_' + ID]` em dev. Propagar `tenantId` dos callers (têm `locals.tenant`): `wpMenu`, `boltConfig`, `footerData` e as páginas.

### 7. Sitemap → origem (WP)
- Remover `@astrojs/sitemap`. O front não gera sitemap.
- O `<link rel="sitemap">` aponta para o sitemap da origem WP do tenant (`${tenant.blog.wpBaseUrl}/sitemap_index.xml`, Yoast). Sem geração local.

### 8. Deploy — 1 worker
- `wrangler.jsonc` único: o worker `frontend` com `routes` para apex + `www` de **cada** site em `SITES` (custom domains/zonas). KV **compartilhado** `SESSION` + `WP_CACHE` (ids reais). Secrets `WP_AUTH_<ID>` por site.
- Remover `sites.manifest.json`, `scripts/gen-wrangler.mjs`, `wrangler.limitemais.json` e (se obsoleto) `scripts/fleet-healthcheck.mjs`.
- Nota de infra (fora deste código): o `wpBaseUrl` do tenant precisa apontar para a origem WP real (não para o próprio domínio público servido pelo worker), senão o fetch SSR faz loop. Pré-requisito de deploy, não bloqueia o runtime local.

## Sequenciamento da implementação
1. `sites.config.ts` + `resolveTenantByHost` (+ testes).
2. `middleware.ts` resolve → `locals.tenant` (+ dev fallback) e `env.d.ts`.
3. Converter os 11 `.astro` para `Astro.locals.tenant`; podar `tenant.ts`.
4. `astro.config.ts` genérico (remove baking/site/sitemap/i18n; publicDir).
5. Mover `_headers`/`_redirects` p/ `./public`; remover `tenants/` e `tenant.build.ts`.
6. `wp-runtime.ts` secret por-tenant.
7. `<link rel=sitemap>` → WP.
8. Deploy: `wrangler.jsonc` único; remover manifest/gen-wrangler/wrangler.limitemais.

## Testes / validação
- Unit: `resolveTenantByHost` — apex, `www.`, subdomínio, host com porta, host desconhecido (→null), e o anti-falso-positivo (`limitemais.com.evil.com` → null).
- Existentes (`wp*`, `seo`, `schemas`) seguem válidos (param-based).
- Visual: Playwright enviando header `Host` por tenant; dev fallback p/ localhost. Com >1 site, validar que cada Host carrega a branding/conteúdo certos.

## Critérios de sucesso
- Um único build serve qualquer site por Host; `localhost` (dev) cai no fallback.
- Host desconhecido ⇒ 404.
- Nenhuma referência a `TENANT_ID`/`TENANT_JSON` baking; nenhum `import { TENANT }` const remanescente.
- `tenants/` não existe; `_headers`/`_redirects` em `./public`.
- WP auth resolvido por `WP_AUTH_<ID>`; cache isolado por tenant.
- `astro check` 0 erros; build OK; vitest verde; preview (header Host) renderiza limitemais.

## Riscos
- Remoção do `i18n`/`site` pode afetar algum uso de `Astro.currentLocale`/`Astro.site` — verificar na implementação (grep indicou que não há).
- Build não roda no diretório-fonte original sem o install standalone já feito; verificar com `pnpm` local.
- Deploy real depende do `wpBaseUrl` apontar para a origem WP (infra), fora do escopo de código.
