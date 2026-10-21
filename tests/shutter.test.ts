import { describe, expect, it } from "vitest";
import { getShutter, MESSAGES, postShutter, RATE_LIMIT, RATE_WINDOW_MS } from "../worker/shutter";
import { env, fakeRoom } from "./helpers";

const post = (action: unknown) =>
  new Request("https://app.test/api/shutter", { method: "POST", body: JSON.stringify({ action }) });

describe("POST /api/shutter", () => {
  it("sends the action and says who sent it", async () => {
    const e = env();
    const room = fakeRoom();
    const res = await postShutter(post("down"), e, "Mum", room.fetch);
    expect(res.status).toBe(200);
    expect((await res.json()).last).toMatchObject({ action: "down", by: "Mum" });
  });

  it("rejects anything but up, down and stop without contacting the room server", async () => {
    const room = fakeRoom();
    for (const action of ["open", "", null, { on: true }]) {
      const res = await postShutter(post(action), env(), "Mum", room.fetch);
      expect(res.status).toBe(400);
    }
    expect(room.requests).toHaveLength(0);
  });

  it("rate-limits each person separately and recovers after the window", async () => {
    const e = env();
    const room = fakeRoom();
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect((await postShutter(post("stop"), e, "Kid", room.fetch, t0 + i)).status).toBe(200);
    }
    const limited = await postShutter(post("stop"), e, "Kid", room.fetch, t0 + RATE_LIMIT);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe(MESSAGES.rateLimited);

    expect((await postShutter(post("stop"), e, "Mum", room.fetch, t0 + RATE_LIMIT)).status).toBe(200);
    expect((await postShutter(post("stop"), e, "Kid", room.fetch, t0 + RATE_WINDOW_MS + 10)).status).toBe(200);
    expect(room.calls.filter((c) => c.name === "shutter")).toHaveLength(RATE_LIMIT + 2);
  });

  it("explains a failure in plain words and logs it as not sent", async () => {
    const e = env();
    const room = fakeRoom();
    room.fail = "down";
    const res = await postShutter(post("up"), e, "Mum", room.fetch);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(MESSAGES.unreachable);

    room.fail = "rm4";
    expect((await (await postShutter(post("up"), e, "Mum", room.fetch)).json()).error)
      .toBe(MESSAGES.toolFailed);

    room.fail = undefined;
    const state = await (await getShutter(e, "Mum", room.fetch)).json();
    expect(state.history.map((h: { sent: boolean }) => h.sent)).toEqual([false, false]);
  });
});

describe("GET /api/shutter", () => {
  it("shows the last command and who sent it from this app", async () => {
    const e = env();
    const room = fakeRoom();
    await postShutter(post("up"), e, "Dad", room.fetch);
    const state = await (await getShutter(e, "Mum", room.fetch)).json();
    expect(state.me).toBe("Mum");
    expect(state.reachable).toBe(true);
    expect(state.last).toMatchObject({ action: "up", by: "Dad" });
    expect(state.history).toHaveLength(1);
  });

  it("leaves the sender empty when the last command did not come from the app", async () => {
    const e = env();
    const room = fakeRoom();
    await postShutter(post("up"), e, "Dad", room.fetch);
    // Another client (the Telegram bot) sends through the same room server.
    await room.fetch(e.ROOM_URL, { method: "POST", headers: { authorization: "Bearer room-token", "mcp-session-id": "x" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "shutter", arguments: { action: "down" } } }) });
    const state = await (await getShutter(e, "Mum", room.fetch)).json();
    expect(state.last).toMatchObject({ action: "down", by: null });
  });

  it("still shows the history when home is unreachable", async () => {
    const e = env();
    const room = fakeRoom();
    await postShutter(post("stop"), e, "Mum", room.fetch);
    room.fail = "down";
    const state = await (await getShutter(e, "Mum", room.fetch)).json();
    expect(state).toMatchObject({ reachable: false, last: null, error: MESSAGES.unreachable });
    expect(state.history).toHaveLength(1);
  });
});
