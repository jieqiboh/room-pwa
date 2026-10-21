import { describe, expect, it } from "vitest";
import { addCard, addPage, moveCard, removeCard, removePage, renamePage, togglePick } from "../src/lib/layout";
import type { DeviceView, Layout } from "../src/lib/api";

const dev = (over: Partial<DeviceView>): DeviceView => ({
  id: "d", name: "D", kind: "shutter", buttons: [], presets: [], repeat: [],
  last_action: null, sent_at: null, on: null, brightness: null, error: null, by: null, ...over,
});
const base = (): Layout => ({
  pages: [
    { id: "a", name: "A", cards: [{ device: "x", picks: [] }, { device: "y", picks: ["p", "q"] }, { device: "z", picks: [] }] },
    { id: "b", name: "B", cards: [] },
  ],
  last: "a",
});
const frozen = () => {
  const l = base();
  return { l, copy: structuredClone(l) };
};

describe("layout edits", () => {
  it("addPage appends, sets last, uses a uuid", () => {
    const { l, copy } = frozen();
    const r = addPage(l, "C");
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.layout.pages.at(-1)).toEqual({ id: r.id, name: "C", cards: [] });
    expect(r.layout.last).toBe(r.id);
    expect(l).toEqual(copy);
  });

  it("removePage moves last to the first remaining page", () => {
    const { l, copy } = frozen();
    expect(removePage(l, "a")).toEqual({ pages: [l.pages[1]], last: "b" });
    expect(removePage(l, "b").last).toBe("a");
    expect(l).toEqual(copy);
  });

  it("removePage of the only page gives no pages and null last", () => {
    expect(removePage({ pages: [{ id: "a", name: "A", cards: [] }], last: "a" }, "a")).toEqual({ pages: [], last: null });
  });

  it("addCard: aircon picks all buttons", () => {
    const { l, copy } = frozen();
    const d = dev({ id: "ac", kind: "aircon", buttons: [{ id: "on", label: "On" }, { id: "off", label: "Off" }] });
    const r = addCard(l, "b", d);
    expect(r.pages[1].cards).toEqual([{ device: "ac", picks: ["on", "off"] }]);
    expect(l).toEqual(copy);
  });

  it("addCard: other kinds get no picks", () => {
    const r = addCard(base(), "b", dev({ id: "l", kind: "lights", presets: ["warm"] }));
    expect(r.pages[1].cards).toEqual([{ device: "l", picks: [] }]);
  });

  it("moveCard swaps and is a no-op at the edges", () => {
    const { l, copy } = frozen();
    expect(moveCard(l, "a", 1, -1).pages[0].cards.map((c) => c.device)).toEqual(["y", "x", "z"]);
    expect(moveCard(l, "a", 1, 1).pages[0].cards.map((c) => c.device)).toEqual(["x", "z", "y"]);
    expect(moveCard(l, "a", 0, -1)).toEqual(l);
    expect(moveCard(l, "a", 2, 1)).toEqual(l);
    expect(l).toEqual(copy);
  });

  it("removeCard", () => {
    const { l, copy } = frozen();
    expect(removeCard(l, "a", 1).pages[0].cards.map((c) => c.device)).toEqual(["x", "z"]);
    expect(l).toEqual(copy);
  });

  it("togglePick removes and adds", () => {
    const { l, copy } = frozen();
    expect(togglePick(l, "a", 1, "p").pages[0].cards[1].picks).toEqual(["q"]);
    expect(togglePick(l, "a", 1, "r").pages[0].cards[1].picks).toEqual(["p", "q", "r"]);
    expect(l).toEqual(copy);
  });

  it("renamePage", () => {
    const { l, copy } = frozen();
    expect(renamePage(l, "b", "Z").pages[1].name).toBe("Z");
    expect(l).toEqual(copy);
  });
});
