import { Pipeline, PipelineSession } from './maestro-sdk';
import type { PipelineEntry, PipelineRequest } from './maestro-sdk';
import astro from '../dist/server/entry.mjs';

interface Env {
  ENVIRONMENT?: string;
  ASSETS: Fetcher;
  SESSION: KVNamespace;
  WP_CACHE: KVNamespace;
}

type Config = Record<string, never>;

class WpSitesSession extends PipelineSession<Config, Env> {
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
      enabled: true,
      htmlOnly: false,
      successOnly: false,
      routes: ['*'],
      timeouts: { intercept: 10000 },
      config: {},
    };
  }
  createSession(): WpSitesSession {
    return new WpSitesSession(this.env, this.ctx);
  }
}
