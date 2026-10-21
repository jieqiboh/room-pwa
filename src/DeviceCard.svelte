<script lang="ts">
  import type { Card, DeviceView } from './lib/api'
  import { cardView } from './lib/cards'

  type LightsOpts = { on?: boolean; brightness?: number; preset?: string }
  interface Props {
    card: Card
    device: DeviceView | undefined
    busy: boolean
    disabled?: boolean
    reachable?: boolean
    onpress: (device: string, button: string) => void
    onlights: (device: string, opts: LightsOpts) => void
    onsavepreset: (device: string, name: string) => Promise<boolean>
  }
  let { card, device, busy, disabled = false, reachable = true, onpress, onlights, onsavepreset }: Props = $props()

  const view = $derived(cardView(card, device, reachable))
  const off = $derived(busy || disabled || !!device?.error)

  function when(iso: string | number): string {
    const d = new Date(iso)
    const h = d.getHours()
    const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
  }

  const label = (id: string) => device?.buttons.find((b) => b.id === id)?.label ?? id

  const status = $derived.by(() => {
    if (!device) return ''
    if (device.error) return 'Not answering right now'
    if (device.kind === 'lights') {
      if (!reachable) return '—'
      if (device.on === null) return ''
      return device.on ? `On${device.brightness !== null ? ` · ${device.brightness}%` : ''}` : 'Off'
    }
    if (!device.last_action || !device.sent_at) return 'Last: nothing yet'
    return `Last: ${label(device.last_action)} · ${when(device.sent_at)}${device.by ? ` by ${device.by}` : ''}`
  })

  let saving = $state(false)
  let presetName = $state('')

  async function savePresetName() {
    if (!presetName.trim()) return
    if (await onsavepreset(card.device, presetName.trim())) {
      saving = false
      presetName = ''
    }
  }

  const onChange = (e: Event) =>
    onlights(card.device, { brightness: Number((e.currentTarget as HTMLInputElement).value) })
</script>

<section class="card">
  <h2>{device?.name ?? card.device}</h2>
  {#if view.missing}
    <p class="status">No longer available</p>
  {:else if view.waiting}
    <p class="status">Waiting for home…</p>
  {:else}
    <p class="status">{status}&nbsp;</p>
    {#if device?.kind === 'lights'}
      <div class="row">
        <button class:active={device.on === true} disabled={off} onclick={() => onlights(card.device, { on: true })}>On</button>
        <button class:active={device.on === false} disabled={off} onclick={() => onlights(card.device, { on: false })}>Off</button>
        {#each view.presets as p}
          <button disabled={off} onclick={() => onlights(card.device, { preset: p })}>{p}</button>
        {/each}
      </div>
      <input
        type="range"
        min="1"
        max="100"
        value={device.brightness ?? 50}
        disabled={off}
        aria-label="Brightness"
        onchange={onChange}
      />
      {#if reachable && !device.error}
        {#if saving}
          <div class="row save">
            <input
              type="text"
              class="name"
              maxlength="30"
              placeholder="Preset name"
              aria-label="Preset name"
              bind:value={presetName}
              onkeydown={(e) => e.key === 'Enter' && !off && savePresetName()}
            />
            <button disabled={off || !presetName.trim()} onclick={savePresetName}>Save</button>
            <button disabled={busy} onclick={() => { saving = false; presetName = '' }}>Cancel</button>
          </div>
        {:else}
          <div class="row save">
            <button disabled={off} onclick={() => (saving = true)}>Save as preset…</button>
          </div>
        {/if}
      {/if}
    {:else}
      <div class="row">
        {#each view.buttons as b}
          <button disabled={off} onclick={() => onpress(card.device, b.id)}>{b.label}</button>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .card { background: #1f2937; border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; }
  h2 { font-size: 1.1rem; margin: 0 0 2px; }
  .status { color: var(--muted); font-size: 0.9rem; margin: 0 0 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  button {
    flex: 1 1 0;
    min-width: 72px;
    min-height: 48px;
    border: none;
    border-radius: 12px;
    background: var(--button);
    color: var(--fg);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:active { background: var(--button-active); }
  button.active { background: #2563eb; }
  button:disabled { opacity: 0.5; }
  input[type='range'] { width: 100%; margin: 14px 0 2px; }
  .save { margin-top: 12px; }
  input.name {
    flex: 2 1 160px;
    min-height: 48px;
    box-sizing: border-box;
    border: none;
    border-radius: 12px;
    background: var(--button);
    color: var(--fg);
    font-size: 1rem;
    padding: 0 12px;
  }
</style>
