import type { Env } from "./env";

// Shared-password gate. Logging in takes the password and the person's name; the
// cookie holds the name plus an HMAC of it keyed by SITE_PASSWORD, so the name
// cannot be edited and changing the password signs everyone out. With no
// SITE_PASSWORD set nobody gets in (fail closed).

const COOKIE = "room_auth";
const MAX_AGE = 365 * 24 * 3600;
// Wrong passwords per IP before logins are refused for the rest of the window.
export const LOGIN_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Trimmed, single-line, at most 30 characters; null if nothing is left.
export function cleanName(raw: string): string | null {
  const name = raw.replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 30);
  return name || null;
}

// The signed-in person's name, or null when not signed in.
export async function userName(req: Request, env: Env): Promise<string | null> {
  if (!env.SITE_PASSWORD) return null;
  const cookie = readCookie(req, COOKIE);
  const dot = cookie?.lastIndexOf(".") ?? -1;
  if (!cookie || dot < 0) return null;
  const encoded = cookie.slice(0, dot);
  if (!timingSafeEqual(cookie.slice(dot + 1), await hmac(env.SITE_PASSWORD, encoded))) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export async function handleLogin(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const failures = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, now - LOGIN_WINDOW_MS).first<{ n: number }>();
  if ((failures?.n ?? 0) >= LOGIN_FAILURES) {
    return loginPage("Too many wrong passwords. Wait 15 minutes and try again.", 429);
  }

  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const name = cleanName(String(form?.get("name") ?? ""));
  if (!env.SITE_PASSWORD || !timingSafeEqual(password, env.SITE_PASSWORD)) {
    await env.DB.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now).run();
    await env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - LOGIN_WINDOW_MS).run();
    return loginPage("Wrong password. Try again.", 401, name ?? "");
  }
  if (!name) return loginPage("Enter your name.", 400);

  const encoded = encodeURIComponent(name);
  const token = `${encoded}.${await hmac(env.SITE_PASSWORD, encoded)}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`,
    },
  });
}

export function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function loginPage(error = "", status = 200, name = ""): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1f2937">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<title>Shutter</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#111827; color:#f9fafb;
    font-family:system-ui,-apple-system,sans-serif; color-scheme:dark; }
  .card { width:min(360px,calc(100vw - 32px)); background:#1f2937; border-radius:18px; padding:28px 24px; }
  h1 { font-size:26px; margin:0 0 4px; }
  p { color:#9ca3af; font-size:15px; margin:0 0 18px; }
  label { display:block; font-size:14px; color:#9ca3af; margin:0 0 6px; }
  input { width:100%; box-sizing:border-box; border:1.5px solid #4b5563; border-radius:11px; padding:13px 14px;
    font-size:17px; background:#111827; color:#f9fafb; outline:none; margin-bottom:14px; }
  input:focus { border-color:#60a5fa; }
  button { width:100%; border:none; border-radius:11px; padding:14px; font-size:17px; font-weight:600;
    background:#2563eb; color:#fff; cursor:pointer; }
  .err { color:#fca5a5; font-size:15px; margin:0 0 14px; }
</style></head><body>
  <form class="card" method="POST" action="/__login">
    <h1>Shutter</h1>
    <p>Sign in once on this phone.</p>
    ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
    <label for="name">Your name</label>
    <input id="name" name="name" value="${escapeHtml(name)}" placeholder="e.g. Mum" autocomplete="nickname" maxlength="30" required />
    <label for="password">Password</label>
    <input id="password" type="password" name="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
