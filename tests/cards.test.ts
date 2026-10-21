import { describe, expect, it } from "vitest";
import { cardView } from "../src/lib/cards";
import type { DeviceView } from "../src/lib/api";

const dev = (over: Partial<DeviceView>): DeviceView => ({
  id: "d", name: "D", kind: "shutter", buttons: [], presets: [],
  last_action: null, sent_at: null, on: null, brightness: null, error: null, by: null, ...over,
});
const btn = (id: string) => ({ id, label: id });

describe("cardView", () => {
  it("aircon shows only picks, in device order", () => {
    const d = dev({ kind: "aircon", buttons: [btn("cool_24_fan2"), btn("cool_26_fan4"), btn("off")] });
    const v = cardView({ device: "d", picks: ["off", "cool_24_fan2"] }, d);
    expect(v.buttons.map((b) => b.id)).toEqual(["cool_24_fan2", "off"]);
  });

  it("stale picks are skipped", () => {
    const d = dev({ kind: "aircon", buttons: [btn("off")] });
    expect(cardView({ device: "d", picks: ["gone"] }, d).buttons).toEqual([]);
  });

  it("shutter and fan show all buttons", () => {
    for (const kind of ["shutter", "fan"]) {
      const d = dev({ kind, buttons: [btn("a"), btn("b")] });
      expect(cardView({ device: "d", picks: [] }, d).buttons.map((b) => b.id)).toEqual(["a", "b"]);
    }
  });

  it("lights shows picked presets", () => {
    const d = dev({ kind: "lights", presets: ["warm", "cool", "night"] });
    expect(cardView({ device: "d", picks: ["night", "gone", "warm"] }, d).presets).toEqual(["warm", "night"]);
  });

  it("missing device", () => {
    const v = cardView({ device: "x", picks: ["a"] }, undefined);
    expect(v).toEqual({ missing: true, waiting: false, buttons: [], presets: [] });
  });

  it("unreachable with no device is waiting, not missing", () => {
    const v = cardView({ device: "x", picks: ["a"] }, undefined, false);
    expect(v).toEqual({ missing: false, waiting: true, buttons: [], presets: [] });
  });
});
