import type { Env } from "./env";
import { json } from "./util";
import { callTool, RoomUnreachable, ToolFailed } from "./mcp";
import { getLayout } from "./layout";

// A few presses per person per window, so a stuck button cannot hammer a device.
export const RATE_LIMIT = 4;
export const RATE_WINDOW_MS = 10_000;

export const MESSAGES = {
  unreachable: "Can't reach home. Is the PC on?",
  toolFailed: "Home answered, but the device didn't. Try again, or use its own remote.",
  rateLimited: "Too many presses. Wait a few seconds and try again.",
  badRequest: "Unknown button.",
};

export interface Device {
  id: string; name: string; kind: string;
  buttons: { id: string; label: string }[];
  presets: string[];
  last_action: string | null; sent_at: string | null;
  on: boolean | null; brightness: number | null; error: string | null;
}
interface House { devices: Device[] }
interface Sent { action: string; sent_at: string }
interface Changed { target: string; done: string; note: string | null }

export async function getHouse(env: Env, who: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  const layout = await getLayout(env, who);
  let house: House;
  try {
    house = await callTool<House>(env, "house", {}, fetchFn);
  } catch (e) {
    return json({ me: who, layout, reachable: false, error: friendly(e), devices: [] });
  }

  // The room server keeps the last command from any client (this app, the Telegram
  // bot). If it was one of ours, the matching press says who sent it.
  const devices = await Promise.all(house.devices.map(async (d) => {
    const mine = d.sent_at === null ? null : await env.DB
      .prepare("SELECT who FROM presses WHERE device = ? AND sent_at = ? ORDER BY id DESC LIMIT 1")
      .bind(d.id, d.sent_at).first<{ who: string }>();
    return { ...d, by: mine?.who ?? null };
  }));
  return json({ me: who, layout, reachable: true, devices });
}

export async function postPress(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const body = await readBody(req);
  const { device, button } = body;
  if (!nonEmpty(device) || !nonEmpty(button)) return json({ error: MESSAGES.badRequest }, 400);

  const limited = await rateLimit(env, who, now);
  if (limited) return limited;

  try {
    const sent = await callTool<Sent>(env, "press", { device, button }, fetchFn);
    await log(env, who, device, button, now, sent.sent_at, null);
    return json({ last: { action: sent.action, sent_at: sent.sent_at, by: who } });
  } catch (e) {
    await log(env, who, device, button, now, null, errorText(e));
    return json({ error: friendly(e) }, 502);
  }
}

export async function postLights(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const { device, on, brightness, preset } = await readBody(req);
  const args: Record<string, unknown> = { device };
  if (!nonEmpty(device)) return json({ error: MESSAGES.badRequest }, 400);
  if (on !== undefined) {
    if (typeof on !== "boolean") return json({ error: MESSAGES.badRequest }, 400);
    args.on = on;
  }
  if (brightness !== undefined) {
    if (!Number.isInteger(brightness) || (brightness as number) < 1 || (brightness as number) > 100) {
      return json({ error: MESSAGES.badRequest }, 400);
    }
    args.brightness = brightness;
  }
  if (preset !== undefined) {
    // A preset stands alone, as in the room server.
    if (!nonEmpty(preset) || on !== undefined || brightness !== undefined) {
      return json({ error: MESSAGES.badRequest }, 400);
    }
    args.preset = preset;
  }
  if (args.on === undefined && args.brightness === undefined && args.preset === undefined) {
    return json({ error: MESSAGES.badRequest }, 400);
  }
  const action = args.preset !== undefined ? `preset ${preset}`
    : args.brightness !== undefined ? `brightness ${brightness}`
    : on ? "on" : "off";

  const limited = await rateLimit(env, who, now);
  if (limited) return limited;

  try {
    const changed = await callTool<Changed>(env, "lights", args, fetchFn);
    await log(env, who, device, action, now, null, null);
    return json({ done: changed.done, note: changed.note });
  } catch (e) {
    await log(env, who, device, action, now, null, errorText(e));
    return json({ error: friendly(e) }, 502);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* falls through as empty */ }
  return {};
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

async function rateLimit(env: Env, who: string, now: number): Promise<Response | null> {
  const recent = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM presses WHERE who = ? AND at > ?")
    .bind(who, now - RATE_WINDOW_MS).first<{ n: number }>();
  return (recent?.n ?? 0) >= RATE_LIMIT ? json({ error: MESSAGES.rateLimited }, 429) : null;
}

const log = (
  env: Env, who: string, device: string, action: string, at: number, sentAt: string | null, error: string | null,
) => env.DB
  .prepare("INSERT INTO presses (who, device, action, at, sent_at, error) VALUES (?, ?, ?, ?, ?, ?)")
  .bind(who, device, action, at, sentAt, error).run();

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function friendly(e: unknown): string {
  if (e instanceof ToolFailed) return MESSAGES.toolFailed;
  if (e instanceof RoomUnreachable) return MESSAGES.unreachable;
  return MESSAGES.unreachable;
}
