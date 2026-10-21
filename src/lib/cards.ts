import type { Button, Card, DeviceView } from './api'

export function cardView(
  card: Card,
  device: DeviceView | undefined,
  reachable = true,
): { missing: boolean; waiting: boolean; buttons: Button[]; presets: string[] } {
  if (!device) return { missing: reachable, waiting: !reachable, buttons: [], presets: [] }
  const none = { missing: false, waiting: false }
  if (device.kind === 'aircon') {
    return { ...none, buttons: device.buttons.filter((b) => card.picks.includes(b.id)), presets: [] }
  }
  if (device.kind === 'lights') {
    return { ...none, buttons: [], presets: device.presets }
  }
  return { ...none, buttons: device.buttons, presets: [] }
}
