import { describe, expect, it } from "vitest";
import { cleanName, handleLogin, LOGIN_FAILURES, LOGIN_WINDOW_MS, userName } from "../worker/auth";
import worker from "../worker/index";
import type { Env } from "../worker/env";
import { env } from "./helpers";

const login = (e: Env, name: string, password: string, now?: number, ip = "1.2.3.4") =>
  handleLogin(new Request("https://app.test/__login", {
    method: "POST", headers: { "cf-connecting-ip": ip }, body: new URLSearchParams({ name, password }),
  }), e, now);

const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

const withCookie = (cookie: string, path = "/api/shutter") =>
  new Request(`https://app.test${path}`, { headers: { cookie } });

describe("login", () => {
  it("signs in with the right password and remembers the name", async () => {
    const e = env();
    const res = await login(e, "  Mum ", "open sesame");
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; Secure/);
    expect(await userName(withCookie(cookieOf(res)), e)).toBe("Mum");
  });

  it("rejects a wrong password or a missing name", async () => {
    const e = env();
    expect((await login(e, "Mum", "wrong")).status).toBe(401);
    expect((await login(e, "   ", "open sesame")).status).toBe(400);
  });

  it("rejects an edited cookie and signs everyone out when the password changes", async () => {
    const e = env();
    const cookie = cookieOf(await login(e, "Kid", "open sesame"));
    const forged = cookie.replace("room_auth=Kid", "room_auth=Mum");
    expect(await userName(withCookie(forged), e)).toBeNull();
    expect(await userName(withCookie(cookie), { ...e, SITE_PASSWORD: "new password" })).toBeNull();
  });

  it("lets nobody in when no password is configured", async () => {
    const e = env({ SITE_PASSWORD: undefined });
    expect((await login(e, "Mum", "")).status).toBe(401);
    expect((await login(e, "Mum", "undefined")).status).toBe(401);
  });

  it("refuses logins from an IP after too many wrong passwords, until the window passes", async () => {
    const e = env();
    const t0 = 5_000_000;
    for (let i = 0; i < LOGIN_FAILURES; i++) await login(e, "x", "guess", t0 + i);
    expect((await login(e, "Mum", "open sesame", t0 + 100)).status).toBe(429);
    expect((await login(e, "Mum", "open sesame", t0 + 100, "5.6.7.8")).status).toBe(302);
    expect((await login(e, "Mum", "open sesame", t0 + LOGIN_WINDOW_MS + 100)).status).toBe(302);
  });

  it("escapes the name on the login page", async () => {
    const res = await login(env(), "<script>", "wrong");
    expect(await res.text()).not.toContain("<script>");
  });
});

describe("cleanName", () => {
  it("trims, collapses spaces, drops control characters and caps the length", () => {
    expect(cleanName("  Big   Sis \n")).toBe("Big Sis");
    expect(cleanName("a\u0000b")).toBe("ab");
    expect(cleanName("x".repeat(50))).toHaveLength(30);
    expect(cleanName(" \t ")).toBeNull();
  });
});

describe("worker gate", () => {
  it("answers 401 on the API and shows the login page elsewhere when signed out", async () => {
    const e = env();
    expect((await worker.fetch(withCookie(""), e)).status).toBe(401);
    const page = await worker.fetch(withCookie("", "/"), e);
    expect(await page.text()).toContain('action="/__login"');
  });

  it("serves the app to a signed-in person", async () => {
    const e = env();
    const cookie = cookieOf(await login(e, "Mum", "open sesame"));
    expect(await (await worker.fetch(withCookie(cookie, "/"), e)).text()).toBe("asset");
  });
});
