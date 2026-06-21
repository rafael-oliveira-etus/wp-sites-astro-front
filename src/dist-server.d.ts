// The Astro Cloudflare adapter emits dist/server/entry.mjs at `astro build`.
// It default-exports the SSR worker ({ fetch }). The file only exists after a
// build, so declare it ambiently for typecheck — astro check / tsc don't need
// the real file present, and wrangler resolves it at bundle (deploy) time.
declare module '../dist/server/entry.mjs' {
  const worker: {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>;
  };
  export default worker;
}
