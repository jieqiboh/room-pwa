import { describe, expect, it } from "vitest";
import { getLayout, putLayout } from "../worker/layout";
import { env } from "./helpers";

const put = (body: unknown) =>
  new Request("https://app.test/api/layout", { method: "PUT", body: JSON.stringify(body) });

const good = {
  pages: [{ id: "p1", name: "Living room", cards: [{ device: "shutter", picks: ["down", "up"] }] }],
  last: "p1",
};

describe("layouts", () => {
  it("round-trips a layout per person", async () => {
    const e = env();
    const res = await putLayout(put(good), e, "Mum");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(good);
    expect(await getLayout(e, "Mum")).toEqual(good);
    expect(await getLayout(e, "JQ")).toEqual({ pages: [], last: null });
  });

  it("rejects bad layouts and stores nothing", async () => {
    const e = env();
    await putLayout(put(good), e, "Mum");
    const page = (id: string, cards: unknown[] = []) => ({ id, name: "P", cards });
    const bad: unknown[] = [
      null,
      { pages: "x" },
      { pages: Array.from({ length: 21 }, (_, i) => page(`p${i}`)), last: null },
      { pages: [page("a", Array.from({ length: 31 }, () => ({ device: "shutter", picks: [] })))], last: null },
      { pages: [page("a"), page("a")], last: null },
      { pages: [page("a", [{ device: "shutter", picks: [] }, { device: "shutter", picks: [] }])], last: null },
      { pages: [{ id: "a", name: "\n\t\u0000", cards: [] }], last: null },
      { pages: [page("a", [{ device: "shutter", picks: ["x".repeat(61)] }])], last: null },
    ];
    for (const body of bad) {
      const res = await putLayout(put(body), e, "Mum");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "That page setup isn't valid." });
      expect(await getLayout(e, "Mum")).toEqual(good);
    }
  });

  it("cleans names and drops an unknown last", async () => {
    const e = env();
    const res = await putLayout(put({ pages: [{ id: "a", name: "  Living\n room ", cards: [] }], last: "zzz" }), e, "Mum");
    expect(res.status).toBe(200);
    expect(await getLayout(e, "Mum")).toEqual({ pages: [{ id: "a", name: "Living room", cards: [] }], last: null });
  });

  it("migration keeps old presses as the JQ shutter", async () => {
    const e = env();
    await e.DB.prepare("INSERT INTO presses (who, action, at) VALUES (?, ?, ?)").bind("JQ", "down", 1).run();
    const row = await e.DB.prepare("SELECT device FROM presses").first<{ device: string }>();
    expect(row?.device).toBe("shutter");
  });
});
