// Minimal D1 typings (subset we use) so the worker is self-contained without
// pulling in @cloudflare/workers-types. wrangler bundles this dir with esbuild.

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  // The room server's MCP endpoint, published by Tailscale Funnel.
  ROOM_URL: string;
  // The room server's bearer token: the only lock on the Funnel address.
  ROOM_TOKEN?: string;
  // The family's shared password, set via `wrangler secret put SITE_PASSWORD`.
  SITE_PASSWORD?: string;
}
