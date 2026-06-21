import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
import type {
  PipelineRequest,
  PipelineResponse,
  PipelineEntry,
  FinalizeMetadata,
  CacheKey,
} from "./types";

/**
 * WorkerEntrypoint for a pipeline worker. Owns the static descriptor
 * (`getConfig`) and acts as a factory for per-request `PipelineSession`s
 * via `createSession`. The actual lifecycle methods live on `PipelineSession`
 * — sessions are `RpcTarget`s, so their instance state survives across RPC
 * calls within a single request (e.g. `init()` can stash a promise on `this`
 * for `transform()` to await).
 *
 * Typical worker structure:
 * ```ts
 * class MySession extends PipelineSession<Config, Env> {
 *   private fetchPromise?: Promise<Data>;
 *
 *   async init(req, config) {
 *     this.fetchPromise = fetchSomething(req, this.env);
 *   }
 *   async transform(req, res, config) {
 *     const data = await this.fetchPromise;
 *     // ...
 *   }
 * }
 *
 * export default class MyPipeline extends Pipeline<Config, Env> {
 *   getConfig() { return { ... }; }
 *   createSession() {
 *     return new MySession(this.env, this.ctx);
 *   }
 * }
 * ```
 *
 * @template TConfig - Shape of the per-pipeline config payload.
 * @template TEnv - Shape of `this.env` (KV, D1, service bindings, vars).
 */
export abstract class Pipeline<
  TConfig = unknown,
  TEnv = unknown
> extends WorkerEntrypoint<TEnv> {
  /**
   * Stub HTTP handler — pipeline workers are invoked exclusively via RPC
   * from maestro and have no registered routes. Cloudflare's deploy validator
   * rejects scripts with no recognized event handlers (error code 10068), so
   * we expose a `fetch` that 404s any direct traffic.
   */
  async fetch(): Promise<Response> {
    return new Response("Pipeline worker — invoke via maestro RPC", {
      status: 404,
    });
  }

  /**
   * Returns this pipeline's static descriptor — name, routes, content-type/status
   * filters, timeouts, and the opaque `config` payload threaded into the session.
   * Called by maestro on every request before any session is created.
   *
   * May be async — e.g. read dynamic config from KV. Cache internally if it's
   * expensive: this is invoked once per request per binding.
   */
  abstract getConfig():
    | PipelineEntry<TConfig>
    | Promise<PipelineEntry<TConfig>>;

  /**
   * Constructs a new `PipelineSession` for the current request. The returned
   * session is an `RpcTarget`; maestro will hold the stub for the rest of the
   * request and call lifecycle methods on it, so any state set on `this`
   * inside the session persists across those calls.
   *
   * Typical implementation: `return new MySession(this.env, this.ctx);`
   */
  abstract createSession():
    | PipelineSession<TConfig, TEnv>
    | Promise<PipelineSession<TConfig, TEnv>>;
}

/**
 * Per-request lifecycle handler for a pipeline. One session is created per
 * request via `Pipeline.createSession()` and invoked by maestro across the
 * stages below. Instance fields persist across these calls — use them to
 * share state (parsed URL, prefetched data, derived flags) between methods.
 *
 * **Lifecycle order:**
 * 1. `getCapabilities()` — once after construction
 * 2. `init()` — parallel across pipelines
 * 3. `intercept()` — sequential, first non-null Response wins
 * 4. `rewriteRequest()` — sequential, cascades (skipped if intercepted)
 * 5. `getCacheKey()` — composite cache lookup
 * 6. (origin fetch or use intercepted response)
 * 7. `process()` — parallel side effects
 * 8. `transform()` / `rewrite()` — sequential body transforms (cached)
 * 9. `hydrate()` — sequential per-request transforms (NOT cached)
 * 10. `finalize()` — parallel via `ctx.waitUntil`
 *
 * @template TConfig - Shape of the per-pipeline config payload.
 * @template TEnv - Shape of `this.env` (KV, D1, service bindings, vars).
 */
export class PipelineSession<
  TConfig = unknown,
  TEnv = unknown
> extends RpcTarget {
  protected env: TEnv;
  protected ctx: ExecutionContext;

  constructor(env: TEnv, ctx: ExecutionContext) {
    super();
    this.env = env;
    this.ctx = ctx;
  }

  /**
   * Reports which lifecycle stages this session overrides, so maestro can skip
   * RPC calls into no-op base implementations.
   *
   * Do not override — the default implementation walks the prototype chain.
   *
   * Note: `"rewrite"` implies `"transform"`. If you override `rewrite()` but
   * leave `transform()` alone, maestro still invokes `transform()` — the base
   * `transform()` runs your `rewrite()` handlers internally.
   */
  getCapabilities(): string[] {
    const base = PipelineSession.prototype;
    const caps: string[] = [];
    if (this.init !== base.init) caps.push("init");
    if (this.intercept !== base.intercept) caps.push("intercept");
    if (this.rewriteRequest !== base.rewriteRequest) caps.push("rewriteRequest");
    if (this.process !== base.process) caps.push("process");
    if (this.rewrite !== base.rewrite) caps.push("rewrite");
    if (this.transform !== base.transform) caps.push("transform");
    if (this.hydrate !== base.hydrate) caps.push("hydrate");
    if (this.finalize !== base.finalize) caps.push("finalize");
    return caps;
  }

  /**
   * Returns this pipeline's cache contribution for the request:
   *
   * - `key`: dimensions to add to the composite full-page cache key. Any input
   *   that could change the cached output (variant id, locale, A/B bucket)
   *   MUST be reflected here — otherwise stale variants leak across users.
   *   Return `""` for pipelines that don't influence the cached body.
   * - `forbidCaching`: when `true`, maestro skips both the cache read and the
   *   cache write for this request. Use for per-request states that must never
   *   reach the cache (preview mode, debug overlays, etc.). If any active
   *   pipeline returns `true`, caching is skipped for the whole request.
   *
   * Runs after `init` and `rewriteRequest`, so any state set by those stages
   * is visible via instance fields.
   */
  getCacheKey(req: PipelineRequest, config: TConfig): CacheKey {
    return { key: "", forbidCaching: false };
  }

  /**
   * One-shot setup at the start of a request. Fires in parallel across all
   * pipelines. `intercept` and `rewriteRequest` await this session's `init`
   * before running, but other sessions do not.
   *
   * This runs BEFORE checking the cache, so don't take too long here, prefer
   * firing async functions that are awaited at a later stage.
   *
   * Use for: KV/D1 prefetches, deriving request-scoped values, kicking off
   * background fetches whose results you'll await later (stash the promise
   * on `this`). Throwing here marks the pipeline `init_failed` in the trace
   * but does NOT abort other pipelines.
   */
  async init(req: PipelineRequest, config: TConfig): Promise<void> {}

  /**
   * Provides an alternative response in place of the origin fetch.
   *
   * Sequential across pipelines in declaration order — the first non-null
   * `Response` wins and short-circuits remaining `intercept` calls. The chosen
   * response still flows through `transform` and `hydrate` on every active
   * pipeline (including ones that came after the interceptor).
   *
   * When an interception happens, `rewriteRequest` is skipped (there is no
   * origin fetch left to rewrite).
   *
   * **Caching:** by default an intercepted response is treated as dynamic —
   * the full-page cache is neither read nor written. A `200` interception can
   * OPT IN by declaring itself publicly cacheable via `Cache-Control`
   * (`public`, and none of `no-store` / `no-cache` / `private`). Opted-in
   * interceptions use the normal full-page cache: the post-`transform` output
   * is stored with the TTL from `max-age`/`s-maxage`, and later requests are
   * served from cache, skipping transforms (`hydrate`/`process` still run
   * per-request). The global gates (logged-in users, any pipeline's
   * `forbidCaching`) still apply. Non-200 interceptions (e.g. redirects) are
   * never cached.
   *
   * Return `null` to defer to the next pipeline / origin fetch.
   *
   * Use for: redirects, maintenance pages, serving static pages, custom routing.
   */
  async intercept(
    req: PipelineRequest,
    config: TConfig
  ): Promise<Response | null> {
    return null;
  }

  /**
   * Mutates the request before the origin fetch. Sequential and cascading —
   * each session receives the previous session's output.
   *
   * Use for: A/B variant URL rewrites, locale routing, header injection
   * destined for the origin.
   *
   * Skipped entirely when a pipeline has already intercepted the request.
   * Returning a different `url` changes which origin is fetched but does
   * NOT change the cache key — reflect any cache-affecting change in
   * `getCacheKey()` as well.
   */
  async rewriteRequest(
    req: PipelineRequest,
    config: TConfig
  ): Promise<PipelineRequest> {
    return req;
  }

  /**
   * Side-effect work that runs alongside the response, after the origin fetch
   * (or cache hit). Fires in parallel across pipelines and is awaited by
   * `ctx.waitUntil` — the response is sent without blocking on `process`.
   *
   * Use for: analytics events, request logging, audit writes. Awaited by
   * `finalize`, so any state `finalize` depends on can be set up here.
   *
   * Subject to the pipeline's `htmlOnly` / `successOnly` filters.
   */
  async process(req: PipelineRequest, config: TConfig): Promise<void> {}

  /**
   * Registers `HTMLRewriter` element handlers for the cacheable transform pass.
   * Called by the default `transform()` — override this for the common case
   * (DOM mutations, script/tag injection, content rewrites).
   *
   * Output IS cached. Anything per-request (user id, session) belongs in
   * `hydrate()` instead.
   *
   * Subject to the pipeline's `htmlOnly` / `successOnly` filters.
   */
  async rewrite(
    rewriter: HTMLRewriter,
    req: PipelineRequest,
    config: TConfig
  ): Promise<void> {}

  /**
   * Per-request response modifications that must NOT be cached. Runs on every
   * response — both cache hits and cache misses. Sequential across pipelines.
   *
   * Use for: identity injection (`pageview_id`, `user_id`), session cookies,
   * any value that varies per-request. Same shape as `transform`, but outside
   * the cache boundary.
   *
   * Subject to the pipeline's `htmlOnly` / `successOnly` filters.
   */
  async hydrate(
    req: PipelineRequest,
    res: PipelineResponse,
    config: TConfig
  ): Promise<PipelineResponse> {
    return res;
  }

  /**
   * Final cleanup, after the response has been sent to the client. Fires in
   * parallel via `ctx.waitUntil` — the user is no longer waiting.
   *
   * Receives a `FinalizeMetadata` (headers + status only, no body — the body
   * has already been streamed). `process` is awaited before `finalize` runs,
   * so analytics correlation IDs etc. are available.
   *
   * Use for: deferred logging, DO state writes, cleanup that depends on the
   * final response shape.
   */
  async finalize(
    req: PipelineRequest,
    metadata: FinalizeMetadata,
    config: TConfig
  ): Promise<void> {}

  /**
   * Cacheable response transform. The default runs `HTMLRewriter` with this
   * session's `rewrite()` handlers — override `rewrite()` for the typical case.
   *
   * Override `transform()` itself only when you need control beyond a single
   * streaming pass: e.g. two-pass buffering, conditional bypass, multi-format
   * rewriting. The returned body is what gets cached and forwarded to
   * `hydrate()`.
   *
   * Subject to the pipeline's `htmlOnly` / `successOnly` filters.
   */
  async transform(
    req: PipelineRequest,
    res: PipelineResponse,
    config: TConfig
  ): Promise<PipelineResponse> {
    const rewriter = new HTMLRewriter();
    await this.rewrite(rewriter, req, config);
    const transformed = rewriter.transform(
      new Response(res.body, { headers: res.headers, status: res.status })
    );

    return {
      body: transformed.body!,
      headers: transformed.headers,
      status: transformed.status,
    };
  }
}
