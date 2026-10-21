import { describe, expect, it } from "vitest";
import { getHouse, MESSAGES, postLights, postPress, postPreset, RATE_LIMIT, RATE_WINDOW_MS } from "../worker/house";
import { putLayout } from "../worker/layout";
import { env, fakeRoom } from "./helpers";

const press = (device: unknown, button: unknown) =>
  new Request("https://app.test/api/press", { method: "POST", body: JSON.stringify({ device, button }) });
const lights = (body: unknown) =>
  new Request("https://app.test/api/lights", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/press", () => {
  it("sends the button and says who sent it", async () => {
    const room = fakeRoom();
    const res = await postPress(press("shutter", "down"), env(), "Mum", room.fetch);
    expect(res.status).toBe(200);
    expect((await res.json()).last).toMatchObject({ action: "down", by: "Mum" });
    expect(room.calls).toEqual([{ name: "press", args: { device: "shutter", button: "down" } }]);
  });

  it("rejects a malformed body without contacting the room server", async () => {
    const room = fakeRoom();
    for (const [d, b] of [["", "down"], ["shutter", ""], [null, "down"], ["shutter", 3], [undefined, undefined]]) {
      const res = await postPress(press(d, b), env(), "Mum", room.fetch);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(MESSAGES.badRequest);
    }
    const junk = new Request("https://app.test/api/press", { method: "POST", body: "nope" });
    expect((await postPress(junk, env(), "Mum", room.fetch)).status).toBe(400);
    expect(room.requests).toHaveLength(0);
  });

  it("explains a failure in plain words and logs it as not sent", async () => {
    const e = env();
    const room = fakeRoom();
    room.fail = "down";
    const res = await postPress(press("shutter", "up"), e, "Mum", room.fetch);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(MESSAGES.unreachable);

    room.fail = "rm4";
    const res2 = await postPress(press("shutter", "up"), e, "Mum", room.fetch);
    expect(res2.status).toBe(502);
    expect((await res2.json()).error).toBe(MESSAGES.toolFailed);

    const rows = await e.DB.prepare("SELECT device, action, sent_at, error FROM presses ORDER BY id").all<any>();
    expect(rows.results).toHaveLength(2);
    for (const r of rows.results) expect(r).toMatchObject({ device: "shutter", action: "up", sent_at: null });
    expect(rows.results[0].error).toBeTruthy();
  });

  it("rate limit counts across devices", async () => {
    const e = env();
    const room = fakeRoom();
    const t0 = 1_000_000;
    const ids = ["shutter", "aircon", "fan", "heater"];
    expect(ids).toHaveLength(RATE_LIMIT);
    for (const [i, id] of ids.entries()) {
      expect((await postPress(press(id, "stop"), e, "Kid", room.fetch, t0 + i)).status).toBe(200);
    }
    const limited = await postPress(press("shutter", "stop"), e, "Kid", room.fetch, t0 + 5);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe(MESSAGES.rateLimited);
    expect((await postPress(press("shutter", "stop"), e, "Mum", room.fetch, t0 + 5)).status).toBe(200);
    expect((await postPress(press("shutter", "stop"), e, "Kid", room.fetch, t0 + RATE_WINDOW_MS + 10)).status).toBe(200);
  });
});

const preset = (body: unknown) =>
  new Request("https://app.test/api/presets", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/presets", () => {
  it("saves the preset and logs it", async () => {
    const e = env();
    const room = fakeRoom();
    const res = await postPreset(preset({ device: "jq-lights", name: "  Movie " }), e, "JQ", room.fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Movie" });
    expect(room.calls).toEqual([{ name: "save_preset", args: { device: "jq-lights", name: "Movie" } }]);
    const row = await e.DB.prepare("SELECT who, device, action, sent_at, error FROM presses").first<any>();
    expect(row).toMatchObject({ who: "JQ", device: "jq-lights", action: "save preset Movie", sent_at: null, error: null });
  });

  it("rejects a bad body", async () => {
    const e = env();
    const room = fakeRoom();
    for (const [body, message] of [[{}, MESSAGES.badRequest], [{ name: "x" }, MESSAGES.badRequest],
      [{ device: "", name: "x" }, MESSAGES.badRequest], [{ device: 5, name: "x" }, MESSAGES.badRequest],
      [{ device: "jq-lights" }, MESSAGES.badPresetName], [{ device: "jq-lights", name: "   " }, MESSAGES.badPresetName],
      [{ device: "jq-lights", name: 5 }, MESSAGES.badPresetName],
      [{ device: "jq-lights", name: "x".repeat(31) }, MESSAGES.badPresetName]] as const) {
      const bad = await postPreset(preset(body), e, "JQ", room.fetch);
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe(message);
    }
    expect(room.calls).toHaveLength(0);
    expect((await postPreset(preset({ device: "jq-lights", name: "x".repeat(30) }), e, "JQ", room.fetch)).status).toBe(200);
  });

  it("is rate limited with the other presses", async () => {
    const e = env();
    const room = fakeRoom();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) await postPress(press("shutter", "stop"), e, "Kid", room.fetch, t0 + i);
    const limited = await postPreset(preset({ device: "jq-lights", name: "x" }), e, "Kid", room.fetch, t0 + 5);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe(MESSAGES.rateLimited);
    expect(room.calls.some((c) => c.name === "save_preset")).toBe(false);
  });

  it("explains a failure and logs it", async () => {
    const e = env();
    const room = fakeRoom();
    room.fail = "down";
    const res = await postPreset(preset({ device: "jq-lights", name: "x" }), e, "JQ", room.fetch);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(MESSAGES.unreachable);
    room.fail = "rm4";
    const tool = await postPreset(preset({ device: "jq-lights", name: "x" }), e, "JQ", room.fetch);
    expect((await tool.json()).error).toBe(MESSAGES.toolFailed);
    const row = await e.DB.prepare("SELECT sent_at, error FROM presses").first<any>();
    expect(row.sent_at).toBeNull();
    expect(row.error).toBeTruthy();
  });
});

describe("POST /api/lights", () => {
  it("validates and logs", async () => {
    const e = env();
    const room = fakeRoom();
    const res = await postLights(lights({ device: "jq-lights", brightness: 40 }), e, "JQ", room.fetch);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ done: true });
    expect(room.calls).toEqual([{ name: "lights", args: { device: "jq-lights", brightness: 40 } }]);

    await postLights(lights({ device: "jq-lights", on: false }), e, "JQ", room.fetch);
    await postLights(lights({ device: "jq-lights", on: true }), e, "JQ", room.fetch);
    await postLights(lights({ device: "jq-lights", preset: "night" }), e, "JQ", room.fetch);
    const rows = await e.DB.prepare("SELECT who, device, action, error FROM presses ORDER BY id").all<any>();
    expect(rows.results.map((r) => r.action)).toEqual(["brightness 40", "off", "on", "preset night"]);
    expect(rows.results[0]).toMatchObject({ who: "JQ", device: "jq-lights", error: null });

    const before = room.calls.length;
    for (const body of [{ device: "jq-lights" }, { brightness: 40 }, { device: "jq-lights", brightness: "bright" },
      { device: "jq-lights", on: "yes" }, { device: "jq-lights", preset: "" }]) {
      const bad = await postLights(lights(body), e, "JQ", room.fetch);
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe(MESSAGES.badRequest);
    }
    expect(room.calls).toHaveLength(before);
  });

  it("explains a failure and logs it", async () => {
    const e = env();
    const room = fakeRoom();
    room.fail = "rm4";
    const res = await postLights(lights({ device: "jq-lights", on: true }), e, "JQ", room.fetch);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(MESSAGES.toolFailed);
    const row = await e.DB.prepare("SELECT sent_at, error FROM presses").first<any>();
    expect(row.sent_at).toBeNull();
    expect(row.error).toBeTruthy();
  });
});

describe("GET /api/house", () => {
  it("returns layout, devices and who pressed", async () => {
    const e = env();
    const room = fakeRoom();
    await putLayout(new Request("https://app.test/api/layout", { method: "PUT",
      body: JSON.stringify({ pages: [{ id: "p1", name: "Room", cards: [{ device: "aircon", picks: ["off"] }] }], last: "p1" }) }), e, "JQ");
    await postPress(press("aircon", "off"), e, "Mum", room.fetch);
    const state = await (await getHouse(e, "JQ", room.fetch)).json();
    expect(state.me).toBe("JQ");
    expect(state.reachable).toBe(true);
    expect(state.layout.pages[0].cards[0].device).toBe("aircon");
    const aircon = state.devices.find((d: any) => d.id === "aircon");
    expect(aircon).toMatchObject({ last_action: "off", by: "Mum" });
    expect(state.devices.find((d: any) => d.id === "shutter").by).toBeNull();
  });

  it("by is per device", async () => {
    const e = env();
    const room = fakeRoom();
    room.sentAt = "2026-10-21T21:04:00+08:00";
    await postPress(press("shutter", "up"), e, "Dad", room.fetch);
    await postPress(press("aircon", "off"), e, "Mum", room.fetch);
    const state = await (await getHouse(e, "JQ", room.fetch)).json();
    expect(state.devices.find((d: any) => d.id === "shutter").by).toBe("Dad");
    expect(state.devices.find((d: any) => d.id === "aircon").by).toBe("Mum");
    expect(state.devices.find((d: any) => d.id === "fan").by).toBeNull();
  });

  it("leaves by empty when the last command did not come from the app", async () => {
    const e = env();
    const room = fakeRoom();
    await postPress(press("shutter", "up"), e, "Dad", room.fetch);
    // Another client (the Telegram bot) sends through the same room server.
    await room.fetch(e.ROOM_URL, { method: "POST", headers: { authorization: "Bearer room-token", "mcp-session-id": "x" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "press", arguments: { device: "shutter", button: "down" } } }) });
    const state = await (await getHouse(e, "JQ", room.fetch)).json();
    expect(state.devices.find((d: any) => d.id === "shutter")).toMatchObject({ last_action: "down", by: null });
  });

  it("getHouse when home is unreachable", async () => {
    const e = env();
    const room = fakeRoom();
    await putLayout(new Request("https://app.test/api/layout", { method: "PUT",
      body: JSON.stringify({ pages: [{ id: "p1", name: "Room", cards: [] }], last: null }) }), e, "JQ");
    room.fail = "down";
    const res = await getHouse(e, "JQ", room.fetch);
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state).toMatchObject({ reachable: false, error: MESSAGES.unreachable, devices: [] });
    expect(state.layout.pages).toHaveLength(1);
  });
});

describe("room server access", () => {
  it("only house tools reach the room server", async () => {
    const e = env();
    const room = fakeRoom();
    await postPress(press("shutter", "up"), e, "Mum", room.fetch);
    await postLights(lights({ device: "jq-lights", on: true }), e, "Mum", room.fetch);
    await postPreset(preset({ device: "jq-lights", name: "x" }), e, "Mum", room.fetch);
    await getHouse(e, "Mum", room.fetch);
    expect(room.calls.length).toBeGreaterThan(0);
    for (const c of room.calls) expect(["house", "press", "lights", "save_preset"]).toContain(c.name);
  });
});
