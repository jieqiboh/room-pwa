import { describe, expect, it } from "vitest";
import { callTool, readReply, RoomUnreachable, ToolFailed } from "../worker/mcp";
import { env, fakeRoom } from "./helpers";

describe("callTool", () => {
  it("refuses tools outside the allowlist without contacting the room server", async () => {
    const room = fakeRoom();
    for (const name of ["set_lights", "apply_preset", "shutter", "shutter_status", "room_status"]) {
      await expect(callTool(env(), name, {}, room.fetch)).rejects.toThrow(/not allowed/);
    }
    expect(room.requests).toHaveLength(0);
  });

  it("initializes, then calls the tool with the session and the bearer token", async () => {
    const room = fakeRoom();
    const sent = await callTool<{ action: string }>(env(), "press", { device: "shutter", button: "stop" }, room.fetch);
    expect(sent.action).toBe("stop");
    expect(room.requests.map((r) => r.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    const call = room.requests[2].headers;
    expect(call.get("mcp-session-id")).toBe("sess-1");
    expect(call.get("authorization")).toBe("Bearer room-token");
    expect(room.calls).toEqual([{ name: "press", args: { device: "shutter", button: "stop" } }]);
  });

  it("reports a failed tool as ToolFailed", async () => {
    const room = fakeRoom();
    room.fail = "rm4";
    await expect(callTool(env(), "press", { device: "shutter", button: "up" }, room.fetch)).rejects.toThrow(ToolFailed);
  });

  it("reports a down PC, a wrong token or an error page as RoomUnreachable", async () => {
    const down = fakeRoom();
    down.fail = "down";
    await expect(callTool(env(), "house", {}, down.fetch)).rejects.toThrow(RoomUnreachable);

    await expect(callTool(env({ ROOM_TOKEN: "wrong" }), "house", {}, fakeRoom().fetch))
      .rejects.toThrow(RoomUnreachable);

    const html = fakeRoom();
    html.fail = "html";
    await expect(callTool(env(), "house", {}, html.fetch)).rejects.toThrow(RoomUnreachable);

    const offline = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(callTool(env(), "house", {}, offline)).rejects.toThrow(RoomUnreachable);
  });
});

describe("readReply", () => {
  it("reads a plain JSON reply", async () => {
    const res = new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: 1 } }),
      { headers: { "content-type": "application/json" } });
    expect((await readReply(res, 2)).result).toEqual({ ok: 1 });
  });

  it("picks the reply to the request among other SSE messages", async () => {
    const res = new Response(
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"ok":2}}\n\n',
      { headers: { "content-type": "text/event-stream" } });
    expect((await readReply(res, 2)).result).toEqual({ ok: 2 });
  });
});
