import { Pipeline, PipelineSession } from './maestro-sdk';
import type { PipelineEntry, PipelineRequest, CacheKey } from './maestro-sdk';
import astro from '../dist/server/entry.mjs';
import { version as WORKER_VERSION } from '../package.json';
import { SERVE_ROUTES, deviceCacheKey } from './pipeline-config';

interface Env {
  ENVIRONMENT?: string;
  ASSETS: Fetcher;
  SESSION: KVNamespace;
  WP_CACHE: KVNamespace;
}

type Config = Record<string, never>;

const ROUTES = SERVE_ROUTES;

class WpSitesSession extends PipelineSession<Config, Env> {
  // Fold device into the composite cache key so mobile/desktop SSR variants
  // cache separately in maestro's full-page cache.
  getCacheKey(req: PipelineRequest): CacheKey {
    return { key: deviceCacheKey(WORKER_VERSION, req.headers['cf-device-type']), forbidCaching: false };
  }

  async intercept(req: PipelineRequest): Promise<Response | null> {
    const request = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return astro.fetch(request, this.env, this.ctx);
  }
}

export default class WpSitesPipeline extends Pipeline<Config, Env> {
  getConfig(): PipelineEntry<Config> {
    return {
      name: 'wp-sites',
      enabled: ROUTES.length > 0,
      htmlOnly: false,
      successOnly: false,
      routes: ROUTES,
      timeouts: { intercept: 10000 },
      config: {},
    };
  }
  createSession(): WpSitesSession {
    return new WpSitesSession(this.env, this.ctx);
  }
}
