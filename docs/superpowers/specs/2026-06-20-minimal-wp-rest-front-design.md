# Design — Enxugar para um front WP-REST mínimo

**Data:** 2026-06-20
**Projeto:** etus-wp-sites-astro-front (front Astro estritamente para a WordPress REST API; tenant único: limitemais)

## Objetivo

Tudo que o front mostra ao usuário vem da API do WordPress. Remover de `public/` toda imagem (branding) e remover o service worker por completo — é um front simples, sem PWA. Os arquivos de config de borda (`_headers`/`_redirects`) **permanecem** por ora (decisão do usuário).

## Contexto (estado atual)

- Branding já é servida pela BOLT config API (`/wp-json/bolt/v1/config` → `branding.favicon_url`, `logo_url`); `tenant.yaml` aponta `logo.src` para URL remota. Os arquivos em `tenants/limitemais/public/` (`favicon-*.png`, `apple-touch-icon.png`, `og-default.{svg,png,webp}`, `logo.{png,webp,avif}`) são apenas **fallback**.
- `BaseHead.astro` usa `faviconUrl` quando presente e cai num ramo estático (`/favicon.svg`, `/apple-touch-icon.png`, mask-icon) quando ausente; OG default é `image = '/og-default.png'`.
- Service worker: `src/pages/sw.js.ts` (fonte do `/sw.js`), `src/components/ServiceWorkerRegister.astro` (renderizado em `BaseLayout.astro:53`), `src/lib/sw-register.ts`. `BUILD_ID`/`PUBLIC_BUILD_ID` (astro.config + env.d.ts) servem **só** para versionar o cache do SW.
- `WebpushPrompt.astro` não é renderizado por nenhum layout (código morto; era feature de quiz).
- **limitemais ainda NÃO foi para produção** → nenhum usuário tem o SW registrado → delete limpo (sem tombstone).

## Mudanças

### 1. Branding 100% do WP (remover imagens de `public/`)

- **Apagar:** `tenants/limitemais/public/{favicon-source.png, favicon-32.png, apple-touch-icon.png, og-default.svg, og-default.png, og-default.webp, logo.png, logo.webp, logo.avif}`.
- **`BaseHead.astro`:**
  - Remover o ramo de fallback estático (`<link rel="icon" href="/favicon.svg">`, apple-touch, mask-icon). Emitir os `<link>` de ícone **apenas** quando `faviconUrl` existir (vindo da BOLT API). Sem `faviconUrl`, não emite ícone → o navegador usa o default, sem requisição 404.
  - OG: mudar o default do prop `image` de `'/og-default.png'` para `undefined`; emitir `og:image`/`twitter:image` (e `image:alt`/`image:type`) **apenas** quando houver imagem (do WP `yoast.ogImage` / featured media). Sem imagem do WP → sem tag de imagem (em vez de apontar para um arquivo local inexistente).

### 2. Remover o service worker

- **Apagar:** `src/pages/sw.js.ts`, `src/components/ServiceWorkerRegister.astro`, `src/lib/sw-register.ts`, `src/components/WebpushPrompt.astro` (morto).
- **`BaseLayout.astro`:** remover o import e o `<ServiceWorkerRegister />`.
- **`astro.config.ts`:** remover a const `BUILD_ID` e o define `import.meta.env.PUBLIC_BUILD_ID` (uso exclusivo do SW).
- **`src/env.d.ts`:** remover `readonly PUBLIC_BUILD_ID: string`.

### 3. Limpar `_headers` (manter o arquivo)

- Remover as regras dos assets apagados: `/favicon.svg`, `/apple-touch-icon.png`, `/og-default.*`, `/logo.*`, `/sw.js`.
- **Manter:** `/_astro/*` (immutable), `/*.html` (revalidate) e o bloco `/*` de **security headers** (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP).

## Fora de escopo (decidido)

- Não realocar `_headers`/`_redirects` para middleware/wrangler agora ("manter por ora").
- Não consolidar `tenant.yaml` num `sites.config`/manifest agora (discussão separada).
- Não há tombstone de SW (projeto não está em produção).

## Critérios de sucesso

- `tenants/limitemais/public/` não contém imagens (só `_headers`/`_redirects`).
- Nenhuma referência a `/sw.js`, `ServiceWorkerRegister`, `sw-register`, `PUBLIC_BUILD_ID`/`BUILD_ID`, `WebpushPrompt` ou aos arquivos de imagem apagados no `src/`.
- `BaseHead` não emite `<link rel=icon>` nem `og:image` apontando para arquivos locais; usa apenas o que vem do WP.
- `_headers` mantém os security headers e regras de `/_astro/*` e `/*.html`.
- Build/typecheck verificados no workspace pnpm (`pnpm --filter frontend check` / build) — não rodam neste diretório (node_modules parcial).

## Riscos

- Se a BOLT API falhar em runtime, a página fica sem favicon (degradação cosmética aceitável; usuário confirmou que a branding vem sempre do WP).
- Build não verificável localmente; validar no workspace antes do merge. Baseline de revert: branch `main` antes deste trabalho.
