import { describe, expect, it } from "vitest";
import { cardView, isRepeat } from "../src/lib/cards";
import type { DeviceView } from "../src/lib/api";

const dev = (over: Partial<DeviceView>): DeviceView => ({
  id: "d", name: "D", kind: "shutter", buttons: [], presets: [], repeat: [],
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

  it("lights offers every preset of the room, whatever the picks", () => {
    const d = dev({ kind: "lights", presets: ["warm", "cool", "night"] });
    expect(cardView({ device: "d", picks: ["night", "gone"] }, d).presets).toEqual(["warm", "cool", "night"]);
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

describe("isRepeat", () => {
  it("is true only for buttons listed in the device's repeat", () => {
    const d = dev({ kind: "fan", repeat: ["speed_up"], buttons: [btn("speed_up"), btn("swing")] })
    expect(isRepeat(d, "speed_up")).toBe(true)
    expect(isRepeat(d, "swing")).toBe(false)
    expect(isRepeat(undefined, "speed_up")).toBe(false)
  })

  it("is false, without throwing, when the device has no repeat", () => {
    const d = dev({ kind: "fan" })
    delete (d as Partial<DeviceView>).repeat
    expect(isRepeat(d, "speed_up")).toBe(false)
  })
})
