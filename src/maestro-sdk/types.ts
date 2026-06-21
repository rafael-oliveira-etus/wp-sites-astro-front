export type PipelineRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  cf: CfProperties;
  /**
   * Request body as a ReadableStream when the incoming request carries
   * one. `null` for body-less requests (GET / HEAD / OPTIONS).
   *
   * Every lifecycle call (`init`, `intercept`, `rewriteRequest`) receives
   * a fresh `ReadableStream` over the same underlying buffer — the
   * orchestrator buffers the body once on entry and rebuilds the stream
   * per consumer. Pipelines may consume it freely; nothing leaks across
   * boundaries.
   *
   * **`rewriteRequest` cannot modify the body today.** Pipelines may
   * change `url` / `method` / `headers` / `cf` and return the updated
   * request, but the orchestrator drops whatever `body` field comes
   * back (because Service Binding RPC wraps streams in proxies, so the
   * orchestrator can't distinguish "pipeline kept the stream we sent"
   * from "pipeline replaced or stripped the body"). The origin fetch
   * always sees a fresh stream rebuilt from the original buffered body.
   * If body modification becomes a requirement, extend the contract
   * with a sentinel (e.g. a `bodyModified: boolean` flag or a factory)
   * — do not rely on reference identity.
   */
  body: ReadableStream | null;
};

export type PipelineResponse = {
  body: ReadableStream;
  /**
   * Live `Headers` instance. Use a real `Headers` (not a `Record<string,
   * string>`) so multi-value headers — chiefly `Set-Cookie` — survive
   * stage boundaries. Pipelines that mutate headers should
   * `new Headers(res.headers)` to get a writable copy.
   */
  headers: Headers;
  status: number;
};

export type FinalizeMetadata = {
  /**
   * Live `Headers` instance with the final response's headers.
   * Multi-value `Set-Cookie` is preserved (see `PipelineResponse.headers`).
   */
  headers: Headers;
  status: number;
};

export type CacheKey = {
  key: string;
  forbidCaching: boolean;
};

export type PipelineEntry<TConfig = Record<string, unknown>> = {
  name: string;
  enabled: boolean;
  htmlOnly: boolean;
  successOnly: boolean;
  routes: string[];
  config: TConfig;
  timeouts: Record<string, number>;
};
