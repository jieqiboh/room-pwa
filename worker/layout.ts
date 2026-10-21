import type { Env } from "./env";
import { json } from "./util";
import { cleanName } from "./auth";

export interface Card { device: string; picks: string[] }
export interface Page { id: string; name: string; cards: Card[] }
export interface Layout { pages: Page[]; last: string | null }

export const LIMITS = { pages: 20, cards: 30, picks: 40, text: 60 };

const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= LIMITS.text;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLayout(body: unknown): Layout | null {
  if (!isObj(body) || !Array.isArray(body.pages) || body.pages.length > LIMITS.pages) return null;
  const pages: Page[] = [];
  const ids = new Set<string>();
  for (const p of body.pages) {
    if (!isObj(p) || !text(p.id) || ids.has(p.id) || typeof p.name !== "string") return null;
    const name = cleanName(p.name);
    if (!name || !Array.isArray(p.cards) || p.cards.length > LIMITS.cards) return null;
    const cards: Card[] = [];
    for (const c of p.cards) {
      if (!isObj(c) || !text(c.device) || !Array.isArray(c.picks) || c.picks.length > LIMITS.picks) return null;
      if (!c.picks.every(text)) return null;
      cards.push({ device: c.device, picks: c.picks as string[] });
    }
    ids.add(p.id);
    pages.push({ id: p.id, name, cards });
  }
  const last = typeof body.last === "string" && ids.has(body.last) ? body.last : null;
  return { pages, last };
}

export async function getLayout(env: Env, who: string): Promise<Layout> {
  const row = await env.DB.prepare("SELECT data FROM layouts WHERE who = ?").bind(who).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Layout) : { pages: [], last: null };
}

export async function putLayout(req: Request, env: Env, who: string, now = Date.now()): Promise<Response> {
  const layout = parseLayout(await req.json().catch(() => null));
  if (!layout) return json({ error: "That page setup isn't valid." }, 400);
  await env.DB.prepare(
    "INSERT INTO layouts (who, data, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(who) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).bind(who, JSON.stringify(layout), now).run();
  return json(layout);
}
