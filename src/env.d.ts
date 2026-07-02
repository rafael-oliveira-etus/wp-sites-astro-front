/// <reference types="astro/client" />

// The Cloudflare Workers runtime virtual module. `wrangler types` would generate
// this, but it is not part of the typecheck step, so declare the minimal surface
// we use (middleware.ts + wp-runtime.ts read `env` for bindings).
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
  // Minimal surface the vendored maestro SDK (src/maestro-sdk) extends. The
  // runtime (workerd) provides these; we declare only what the SDK uses.
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: ExecutionContext;
    constructor(ctx: ExecutionContext, env: Env);
  }
  export class RpcTarget {}
}

// Minimal Cloudflare Workers runtime globals used by the vendored maestro SDK
// (src/maestro-sdk) and the pipeline entry (src/index.ts). `wrangler types`
// would generate the full set, but it is not part of the typecheck; declare
// only what we use (the app otherwise avoids @cloudflare/workers-types so the
// DOM globals it would clobber stay intact).
type CfProperties = Record<string, unknown>;
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface KVNamespace {
  get(key: string, options?: unknown): Promise<string | null>;
  put(key: string, value: string, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
declare class HTMLRewriter {
  constructor();
  on(selector: string, handlers: unknown): HTMLRewriter;
  onDocument(handlers: unknown): HTMLRewriter;
  transform(response: Response): Response;
}

interface EtusTrackPayload {
  event: string;
  event_id: string;
  ts: string;
  anonymous_id: string;
  session_id: string;
  session_index: number;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
}

interface EtusIdentifyPayload {
  event: 'identify';
  event_id: string;
  ts: string;
  anonymous_id: string;
  session_id: string;
  session_index: number;
  traits: Record<string, unknown>;
  context: Record<string, unknown>;
}

/** Segment-style server event built for POST /v1/e to the events-api worker. */
interface EtusServerEvent {
  type: 'track' | 'identify' | 'page' | 'screen' | 'group' | 'alias';
  messageId: string;
  timestamp: string;
  sentAt: string;
  anonymousId: string;
  userId?: string;
  context: Record<string, unknown>;
  channel: 'web' | 'server' | 'mobile';
  event?: string;
  properties?: Record<string, unknown>;
  traits?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EtusAPI {
  __booted: boolean;
  track: (eventName: string, properties?: Record<string, unknown>) => EtusTrackPayload | undefined;
  identify: (traits?: Record<string, unknown>) => EtusIdentifyPayload | undefined;
  buildServerEvent: (
    type: EtusServerEvent['type'],
    extra?: Partial<EtusServerEvent>,
  ) => EtusServerEvent;
  sendBatch: (events: EtusServerEvent[]) => Promise<Response | null>;
  /** Flush the server-bound queue immediately via keepalive fetch. */
  flush: () => void;
  /** Flush the server-bound queue immediately via sendBeacon (use on pagehide / visibility hidden). */
  flushBeacon: () => void;
  /** T1.10 Consent Mode v2 API. */
  consent: {
    get: () => EtusConsentState;
    set: (state: Partial<EtusConsentState>) => void;
  };
  anonymousId: () => string;
  sessionId: () => string;
  attribution: () => Record<string, unknown>;
  context: () => Record<string, unknown>;
  eventsApiUrl: () => string;
  setQuizLifecycle: (state: 'in_progress' | 'completed' | 'abandoned', extra?: Record<string, unknown>) => void;
  getQuizLifecycle: () => Record<string, unknown> | null;
}

interface TurnstileRenderOptions {
  sitekey: string;
  size?: 'normal' | 'compact' | 'flexible' | 'invisible';
  action?: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
}

interface TurnstileAPI {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
  execute: (id: string) => void;
  getResponse: (id?: string) => string | undefined;
}

interface EtusConsentState {
  analytics: boolean;
  marketing: boolean;
  personalization: boolean;
  ts: number;
  source: 'banner' | 'gpc' | 'default-strict' | 'default-permissive';
}

interface Window {
  dataLayer: Array<Record<string, unknown>>;
  etus?: EtusAPI;
  turnstile?: TurnstileAPI;
  /** Consent-banner init, assigned by src/lib/consent-banner.ts. Re-invoked by
   *  the inline data-astro-rerun shim in ConsentBanner.astro after each View
   *  Transition navigation (bundled modules don't re-run on VT; this shim does). */
  __etusConsentInit?: () => void;
}

/**
 * Request-scoped values set by `src/middleware.ts` on SSR (blog) routes.
 * Prerendered quiz/hub routes skip the middleware, so these are absent there —
 * components reading them on a prerendered page get `undefined`.
 */
declare namespace App {
  interface Locals {
    /** Active tenant for this request, resolved from the Host by middleware. */
    tenant: import('./lib/schemas').Tenant;
    /** Device class (CF-Device-Type → UA fallback, from @etus/ads). Drives
     *  server-side ad gating + the device-keyed edge cache. */
    deviceClass: import('@etus/ads').DeviceClass;
    /** Ad mode: 'live' (prod) | 'test' (sample network /6355419/) | 'off'.
     *  Defaults prod→live, non-prod→test. */
    adsMode: import('@etus/ads').AdsMode;
    /** ISO country from request.cf (geo); null in dev / when unavailable. */
    country: string | null;
    /** Deploy environment from the ENVIRONMENT var ('production' | 'development' | …). */
    environment: string;
    /** environment === 'production'. Drives noindex on non-prod + whether the edge cache runs. */
    isProduction: boolean;
  }
}
