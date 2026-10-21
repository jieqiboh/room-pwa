import type { Env } from "./env";
import { json } from "./util";
import { callTool, RoomUnreachable, ToolFailed } from "./mcp";

export const ACTIONS = ["up", "down", "stop"] as const;
type Action = (typeof ACTIONS)[number];

// A few presses per person per window, so a stuck button cannot hammer the motor.
export const RATE_LIMIT = 4;
export const RATE_WINDOW_MS = 10_000;

const HISTORY = 10;

export const MESSAGES = {
  unreachable: "Can't reach home. Is the PC on?",
  toolFailed: "Home answered, but the shutter remote didn't. Try again, or use the wall remote.",
  rateLimited: "Too many presses. Wait a few seconds and try again.",
  badAction: "Unknown button.",
};

interface Sent { action: string; sent_at: string }
interface LastSent { last_action: string | null; sent_at: string | null }
interface Press { who: string; action: string; at: number; sent_at: string | null; error: string | null }

export async function getShutter(env: Env, who: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  const history = await env.DB
    .prepare("SELECT who, action, at, sent_at, error FROM presses ORDER BY id DESC LIMIT ?")
    .bind(HISTORY).all<Press>();
  const base = {
    me: who,
    history: history.results.map((p) => ({
      by: p.who, action: p.action, at: p.at, sent: p.sent_at !== null, error: p.error,
    })),
  };

  let status: LastSent;
  try {
    status = await callTool<LastSent>(env, "shutter_status", {}, fetchFn);
  } catch (e) {
    return json({ ...base, reachable: false, last: null, error: friendly(e) });
  }
  if (!status.last_action || !status.sent_at) return json({ ...base, reachable: true, last: null });

  // The room server keeps the last command from any client (this app, the Telegram
  // bot). If it was one of ours, the matching press says who sent it.
  const mine = await env.DB
    .prepare("SELECT who FROM presses WHERE sent_at = ? ORDER BY id DESC LIMIT 1")
    .bind(status.sent_at).first<{ who: string }>();
  return json({
    ...base, reachable: true,
    last: { action: status.last_action, sent_at: status.sent_at, by: mine?.who ?? null },
  });
}

export async function postShutter(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  let action: unknown;
  try {
    action = ((await req.json()) as { action?: unknown }).action;
  } catch { /* falls through as undefined */ }
  if (!ACTIONS.includes(action as Action)) return json({ error: MESSAGES.badAction }, 400);

  const recent = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM presses WHERE who = ? AND at > ?")
    .bind(who, now - RATE_WINDOW_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT) return json({ error: MESSAGES.rateLimited }, 429);

  const log = (sentAt: string | null, error: string | null) => env.DB
    .prepare("INSERT INTO presses (who, action, at, sent_at, error) VALUES (?, ?, ?, ?, ?)")
    .bind(who, action, now, sentAt, error).run();

  let sent: Sent;
  try {
    sent = await callTool<Sent>(env, "shutter", { action }, fetchFn);
  } catch (e) {
    await log(null, e instanceof Error ? e.message : String(e));
    return json({ error: friendly(e) }, 502);
  }
  await log(sent.sent_at, null);
  return json({ last: { action: sent.action, sent_at: sent.sent_at, by: who } });
}

function friendly(e: unknown): string {
  if (e instanceof ToolFailed) return MESSAGES.toolFailed;
  if (e instanceof RoomUnreachable) return MESSAGES.unreachable;
  return MESSAGES.unreachable;
}
