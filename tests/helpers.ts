import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement, Env } from "../worker/env";

// D1 on top of an in-memory SQLite, with the real migration applied.
export function fakeDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const prepare = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...v) => prepare(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) ?? null) as T | null,
    run: async () => db.prepare(sql).run(...(values as never[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
  });
  return { prepare: (sql) => prepare(sql) };
}

export function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb(),
    ASSETS: { fetch: async () => new Response("asset") },
    ROOM_URL: "https://pc.tailnet.ts.net/mcp",
    ROOM_TOKEN: "room-token",
    SITE_PASSWORD: "open sesame",
    ...overrides,
  };
}

export interface FakeRoom {
  fetch: typeof fetch;
  calls: { name: string; args: unknown }[];
  requests: { headers: Headers; body: any }[];
  fail?: "rm4" | "down" | "html";
}

// The room server as the Python MCP SDK answers: SSE replies and a session id.
export function fakeRoom(): FakeRoom {
  let last: { last_action: string | null; sent_at: string | null } = { last_action: null, sent_at: null };
  let second = 0;
  const room: FakeRoom = {
    calls: [],
    requests: [],
    fetch: (async (_url: string, init: RequestInit) => {
      if (room.fail === "down") return new Response("bad gateway", { status: 502 });
      if (room.fail === "html") return new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } });
      const headers = new Headers(init.headers);
      if (init.method === "DELETE") return new Response(null);
      const body = JSON.parse(init.body as string);
      room.requests.push({ headers, body });
      if (headers.get("authorization") !== "Bearer room-token") return new Response("no", { status: 401 });

      const sse = (msg: unknown, extra: Record<string, string> = {}) => new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(msg as object) })}\n\n`,
        { headers: { "content-type": "text/event-stream", ...extra } });

      if (body.method === "initialize") {
        return sse({ result: { protocolVersion: body.params.protocolVersion } }, { "mcp-session-id": "sess-1" });
      }
      if (!body.id) return new Response(null, { status: 202 });
      const { name, arguments: args } = body.params;
      room.calls.push({ name, args });
      if (name === "shutter_status") return sse({ result: { structuredContent: { ...last, note: "" } } });
      if (room.fail === "rm4") return sse({ result: { isError: true, content: [{ type: "text", text: "RM4 timeout" }] } });
      last = { last_action: args.action, sent_at: `2026-10-21T21:04:${String(second++).padStart(2, "0")}+08:00` };
      return sse({ result: { structuredContent: { action: args.action, sent_at: last.sent_at } } });
    }) as typeof fetch,
  };
  return room;
}
