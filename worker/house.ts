import type { Env } from "./env";
import { json } from "./util";
import { callTool, RoomUnreachable, ToolFailed } from "./mcp";
import { getLayout } from "./layout";

// A few presses per person per window, so a stuck button cannot hammer a device.
export const RATE_LIMIT = 4;
export const RATE_WINDOW_MS = 10_000;
// As the room server's batch tool allows.
export const BATCH_COMMANDS = 20;
export const BATCH_PRESSES = 48;

export const MESSAGES = {
  unreachable: "Can't reach home. Is the PC on?",
  toolFailed: "Home answered, but the device didn't. Try again, or use its own remote.",
  rateLimited: "Too many presses. Wait a few seconds and try again.",
  badRequest: "Unknown button.",
  badPresetName: "Preset names are 1 to 30 characters.",
};

export interface Device {
  id: string; name: string; kind: string;
  buttons: { id: string; label: string }[];
  presets: string[];
  repeat?: string[];
  last_action: string | null; sent_at: string | null;
  on: boolean | null; brightness: number | null; error: string | null;
}
interface House { devices: Device[] }
interface Sent { action: string; sent_at: string }
interface Changed { target: string; done: string; note: string | null }
interface BatchResult { device: string; ok: boolean; error: string | null }

export async function getHouse(env: Env, who: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  // The layout comes from D1 while the room server is asked, not before.
  const [layout, called] = await Promise.all([
    getLayout(env, who),
    callTool<House>(env, "house", {}, fetchFn).then((h) => ({ house: h }), (e) => ({ error: e })),
  ]);
  if ("error" in called) return json({ me: who, layout, reachable: false, error: friendly(called.error), devices: [] });
  const { house } = called;

  // The room server keeps the last command from any client (this app, the Telegram
  // bot). If it was one of ours, the matching press says who sent it: one query for
  // every device, the newest press winning.
  const sentAts = [...new Set(house.devices.map((d) => d.sent_at).filter((s): s is string => s !== null))];
  const by = new Map<string, string>();
  if (sentAts.length) {
    const { results } = await env.DB
      .prepare(`SELECT device, sent_at, who FROM presses WHERE sent_at IN (${sentAts.map(() => "?").join(", ")}) ORDER BY id DESC`)
      .bind(...sentAts).all<{ device: string; sent_at: string; who: string }>();
    for (const r of results) {
      const key = `${r.device} ${r.sent_at}`;
      if (!by.has(key)) by.set(key, r.who);
    }
  }
  const devices = house.devices.map((d) => ({
    ...d, repeat: d.repeat ?? [], by: d.sent_at === null ? null : by.get(`${d.id} ${d.sent_at}`) ?? null,
  }));
  return json({ me: who, layout, reachable: true, devices });
}

export async function postPress(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const args = pressArgs(await readBody(req));
  if (!args) return json({ error: MESSAGES.badRequest }, 400);
  const { device, button, times = 1 } = args;

  const limited = await rateLimit(env, who, now);
  if (limited) return limited;

  const action = times > 1 ? `${button} ×${times}` : button;
  try {
    const sent = await callTool<Sent>(env, "press", args, fetchFn, times > 1 ? 25_000 : undefined);
    await log(env, who, device, action, now, sent.sent_at, null);
    return json({ last: { action: sent.action, sent_at: sent.sent_at, by: who } });
  } catch (e) {
    await log(env, who, device, action, now, null, errorText(e));
    return json({ error: friendly(e) }, 502);
  }
}

export async function postLights(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const args = lightsArgs(await readBody(req));
  if (!args) return json({ error: MESSAGES.badRequest }, 400);
  const { device, on, brightness, preset } = args;
  const action = preset !== undefined ? `preset ${preset}`
    : brightness !== undefined ? `brightness ${brightness}`
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

export async function postPreset(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const { device, name: raw } = await readBody(req);
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!nonEmpty(device)) return json({ error: MESSAGES.badRequest }, 400);
  if (name.length === 0 || name.length > 30) return json({ error: MESSAGES.badPresetName }, 400);
  const action = `save preset ${name}`;

  const limited = await rateLimit(env, who, now);
  if (limited) return limited;

  try {
    const saved = await callTool<{ name: string }>(env, "save_preset", { device, name }, fetchFn);
    await log(env, who, device, action, now, null, null);
    return json({ name: saved.name });
  } catch (e) {
    await log(env, who, device, action, now, null, errorText(e));
    return json({ error: friendly(e) }, 502);
  }
}

export async function postBatch(
  req: Request, env: Env, who: string, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<Response> {
  const { commands: raw } = await readBody(req);
  const commands = Array.isArray(raw) && raw.length >= 1 && raw.length <= BATCH_COMMANDS
    ? raw.map(batchArgs) : null;
  if (!commands || commands.some((c) => c === null)) return json({ error: MESSAGES.badRequest }, 400);
  const presses = commands.reduce((n, c) => n + ("button" in c! ? (c.times ?? 1) : 0), 0);
  if (presses > BATCH_PRESSES) return json({ error: MESSAGES.badRequest }, 400);
  const action = `batch ${commands.length}`;

  // However many commands, a batch is one tap of Apply all: one press for the rate limit.
  const limited = await rateLimit(env, who, now);
  if (limited) return limited;

  try {
    const { results } = await callTool<{ results: BatchResult[] }>(env, "batch", { commands }, fetchFn, 30_000);
    await log(env, who, "batch", action, now, null, null);
    return json({ results });
  } catch (e) {
    await log(env, who, "batch", action, now, null, errorText(e));
    return json({ error: friendly(e) }, 502);
  }
}

type PressArgs = { device: string; button: string; times?: number };
type LightsArgs = { device: string; on?: boolean; brightness?: number; preset?: string };

// The room server's press arguments, or null when the body is not a valid press.
function pressArgs(body: Record<string, unknown>): PressArgs | null {
  const { device, button } = body;
  if (!nonEmpty(device) || !nonEmpty(button)) return null;
  const times = body.times === undefined ? 1 : body.times;
  if (typeof times !== "number" || !Number.isInteger(times) || times < 1 || times > 24) return null;
  return times > 1 ? { device, button, times } : { device, button };
}

// The room server's lights arguments, or null when the body is not a valid change.
function lightsArgs(body: Record<string, unknown>): LightsArgs | null {
  const { device, on, brightness, preset } = body;
  if (!nonEmpty(device)) return null;
  const args: LightsArgs = { device };
  if (on !== undefined) {
    if (typeof on !== "boolean") return null;
    args.on = on;
  }
  if (brightness !== undefined) {
    if (typeof brightness !== "number" || !Number.isInteger(brightness) || brightness < 1 || brightness > 100) {
      return null;
    }
    args.brightness = brightness;
  }
  if (preset !== undefined) {
    // A preset stands alone, as in the room server.
    if (!nonEmpty(preset) || on !== undefined || brightness !== undefined) return null;
    args.preset = preset;
  }
  if (args.on === undefined && args.brightness === undefined && args.preset === undefined) return null;
  return args;
}

const PRESS_KEYS = new Set(["device", "button", "times"]);
const LIGHTS_KEYS = new Set(["device", "on", "brightness", "preset"]);

// One batch command: a press when it has a button, otherwise a lights change, with no other keys.
function batchArgs(c: unknown): PressArgs | LightsArgs | null {
  if (typeof c !== "object" || c === null || Array.isArray(c)) return null;
  const body = c as Record<string, unknown>;
  const press = "button" in body;
  if (Object.keys(body).some((k) => !(press ? PRESS_KEYS : LIGHTS_KEYS).has(k))) return null;
  return press ? pressArgs(body) : lightsArgs(body);
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
