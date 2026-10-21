import { describe, expect, it } from "vitest";
import {
  commands, firstError, isQueued, queuedLights, queuePress, queueLights, remove, settle, toApi, type Queue,
} from "../src/lib/queue";

const empty: Queue = {};

describe("queuePress", () => {
  it("queues one press per device, a new tap replacing the old", () => {
    const q1 = queuePress(empty, "shutter", "up");
    const q2 = queuePress(q1, "shutter", "down");
    const q3 = queuePress(q2, "fan", "speed_up", 5);
    expect(q1).toEqual({ shutter: { kind: "press", device: "shutter", button: "up", times: 1 } });
    expect(commands(q3)).toEqual([
      { kind: "press", device: "shutter", button: "down", times: 1 },
      { kind: "press", device: "fan", button: "speed_up", times: 5 },
    ]);
  });

  it("leaves the old queue untouched", () => {
    const q1 = queuePress(empty, "shutter", "up");
    queuePress(q1, "shutter", "down");
    remove(q1, "shutter");
    expect(q1.shutter).toMatchObject({ button: "up" });
    expect(empty).toEqual({});
  });
});

describe("queueLights", () => {
  const l = (q: Queue) => queuedLights(q, "jq");

  it("builds up on and brightness", () => {
    expect(l(queueLights(empty, "jq", { on: true }))).toEqual({ kind: "lights", device: "jq", on: true });
    expect(l(queueLights(empty, "jq", { brightness: 40 })))
      .toEqual({ kind: "lights", device: "jq", on: true, brightness: 40 });
    const q = queueLights(queueLights(empty, "jq", { brightness: 40 }), "jq", { brightness: 70 });
    expect(l(q)).toEqual({ kind: "lights", device: "jq", on: true, brightness: 70 });
  });

  it("off clears brightness; brightness after off switches back on", () => {
    const off = queueLights(queueLights(empty, "jq", { brightness: 40 }), "jq", { on: false });
    expect(l(off)).toEqual({ kind: "lights", device: "jq", on: false });
    expect(l(queueLights(off, "jq", { brightness: 20 })))
      .toEqual({ kind: "lights", device: "jq", on: true, brightness: 20 });
  });

  it("a preset stands alone, and on or brightness clears it", () => {
    const p = queueLights(queueLights(empty, "jq", { brightness: 40 }), "jq", { preset: "night" });
    expect(l(p)).toEqual({ kind: "lights", device: "jq", preset: "night" });
    expect(l(queueLights(p, "jq", { on: true }))).toEqual({ kind: "lights", device: "jq", on: true });
    expect(l(queueLights(p, "jq", { brightness: 10 })))
      .toEqual({ kind: "lights", device: "jq", on: true, brightness: 10 });
  });

  it("an empty change leaves the queue as it was", () => {
    expect(queueLights(empty, "jq", {})).toBe(empty);
    for (const q of [queueLights(empty, "jq", { preset: "night" }), queuePress(empty, "jq", "up")]) {
      expect(queueLights(q, "jq", {})).toBe(q);
    }
  });

  it("replaces a press queued for the same device", () => {
    const q = queueLights(queuePress(empty, "jq", "up"), "jq", { on: true });
    expect(commands(q)).toEqual([{ kind: "lights", device: "jq", on: true }]);
    expect(queuedLights(queuePress(empty, "jq", "up"), "jq")).toBeUndefined();
  });
});

describe("isQueued", () => {
  it("is per device, and per button for a press", () => {
    const q = queueLights(queuePress(empty, "shutter", "up"), "jq", { on: false });
    expect(isQueued(q, "shutter")).toBe(true);
    expect(isQueued(q, "shutter", "up")).toBe(true);
    expect(isQueued(q, "shutter", "down")).toBe(false);
    expect(isQueued(q, "jq")).toBe(true);
    expect(isQueued(q, "jq", "up")).toBe(false);
    expect(isQueued(q, "fan")).toBe(false);
  });
});

describe("remove, settle, firstError", () => {
  const q = queueLights(queuePress(queuePress(empty, "shutter", "up"), "fan", "on"), "jq", { preset: "night" });

  it("remove drops only that device", () => {
    expect(Object.keys(remove(q, "fan"))).toEqual(["shutter", "jq"]);
    expect(remove(q, "nope")).toEqual(q);
  });

  it("settle keeps only the commands that failed", () => {
    const results = [
      { device: "shutter", ok: true, error: null },
      { device: "fan", ok: false, error: "RM4 timeout" },
      { device: "jq", ok: true, error: null },
    ];
    expect(commands(settle(q, results))).toEqual([{ kind: "press", device: "fan", button: "on", times: 1 }]);
    expect(firstError(results)).toBe("RM4 timeout");
    expect(firstError([{ device: "a", ok: true, error: null }])).toBeNull();
    expect(firstError([{ device: "a", ok: false, error: null }])).toBe("a didn't answer. Try again.");
  });
});

describe("toApi", () => {
  it("drops the kind, and times when it is 1", () => {
    expect(commands(q()).map(toApi)).toEqual([
      { device: "shutter", button: "up" },
      { device: "fan", button: "speed_up", times: 3 },
      { device: "jq", on: true, brightness: 30 },
    ]);
    function q() {
      return queueLights(queuePress(queuePress(empty, "shutter", "up"), "fan", "speed_up", 3), "jq", { brightness: 30 });
    }
  });
});
