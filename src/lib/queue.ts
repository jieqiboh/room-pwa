// Commands waiting for Apply all: at most one per device, in the order first queued.
// Every function returns a new queue and leaves the one it was given untouched.

export type PressCommand = { kind: 'press'; device: string; button: string; times: number }
export type LightsCommand = { kind: 'lights'; device: string; on?: boolean; brightness?: number; preset?: string }
export type Command = PressCommand | LightsCommand
export type Queue = Readonly<Record<string, Command>>
export type LightsChange = { on?: boolean; brightness?: number; preset?: string }
export interface BatchResult { device: string; ok: boolean; error: string | null }

const put = (q: Queue, c: Command): Queue => ({ ...q, [c.device]: c })

export const queuePress = (q: Queue, device: string, button: string, times = 1): Queue =>
  put(q, { kind: 'press', device, button, times })

// A preset stands alone; on or brightness clears it. Off clears brightness, and
// brightness switches the lights on. An empty change leaves the queue as it was.
export function queueLights(q: Queue, device: string, change: LightsChange): Queue {
  if (change.on === undefined && change.brightness === undefined && change.preset === undefined) return q
  const prev = queuedLights(q, device)
  let next: LightsCommand
  if (change.preset !== undefined) {
    next = { kind: 'lights', device, preset: change.preset }
  } else {
    next = { kind: 'lights', device }
    let on = prev?.on
    let brightness = prev?.brightness
    if (change.on !== undefined) {
      on = change.on
      if (!on) brightness = undefined
    }
    if (change.brightness !== undefined) {
      brightness = change.brightness
      on = true
    }
    if (on !== undefined) next.on = on
    if (brightness !== undefined) next.brightness = brightness
  }
  return put(q, next)
}

export function remove(q: Queue, device: string): Queue {
  if (!(device in q)) return q
  const { [device]: _, ...rest } = q
  return rest
}

export const commands = (q: Queue): Command[] => Object.values(q)

// Whether the device has a command queued; with a button, whether it is a press of that button.
export function isQueued(q: Queue, device: string, button?: string): boolean {
  const c = q[device]
  if (!c) return false
  return button === undefined || (c.kind === 'press' && c.button === button)
}

export function queuedLights(q: Queue, device: string): LightsCommand | undefined {
  const c = q[device]
  return c?.kind === 'lights' ? c : undefined
}

// What is left after a batch: the commands that failed.
export const settle = (q: Queue, results: BatchResult[]): Queue =>
  results.reduce((left, r) => (r.ok ? remove(left, r.device) : left), q)

export function firstError(results: BatchResult[]): string | null {
  const bad = results.find((r) => !r.ok)
  return bad ? (bad.error ?? `${bad.device} didn't answer. Try again.`) : null
}

// The body the Worker and the room server take for one command.
export function toApi(c: Command): Record<string, unknown> {
  if (c.kind === 'press') {
    return c.times > 1 ? { device: c.device, button: c.button, times: c.times } : { device: c.device, button: c.button }
  }
  const { kind: _, ...rest } = c
  return rest
}
