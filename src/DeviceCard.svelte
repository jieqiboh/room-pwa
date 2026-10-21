<script lang="ts">
  import type { Card, DeviceView } from './lib/api'
  import { cardView, isRepeat } from './lib/cards'
  import { isQueued, queuedLights, type LightsChange, type Queue } from './lib/queue'

  interface Props {
    card: Card
    device: DeviceView | undefined
    busy: boolean
    disabled?: boolean
    reachable?: boolean
    queue: Queue
    onqueuepress: (device: string, button: string, times?: number) => void
    onqueuelights: (device: string, change: LightsChange) => void
    onsend: (device: string) => void
    onsavepreset: (device: string, name: string) => Promise<boolean>
  }
  let {
    card, device, busy, disabled = false, reachable = true, queue, onqueuepress, onqueuelights, onsend, onsavepreset,
  }: Props = $props()

  // Queued (amber) lights fields, and the times of a queued press.
  const lights = $derived(queuedLights(queue, card.device))
  const queuedTimes = $derived.by(() => {
    const c = queue[card.device]
    return c?.kind === 'press' ? c.times : 1
  })

  const view = $derived(cardView(card, device, reachable))
  const off = $derived(busy || disabled || !!device?.error)

  const status = $derived.by(() => {
    if (!device) return ''
    if (device.error) return 'Not answering right now'
    if (device.kind !== 'lights' || !reachable || device.on === null) return ''
    return device.on ? `On${device.brightness !== null ? ` · ${device.brightness}%` : ''}` : 'Off'
  })

  // The select always rests on its empty option, labelled with the queued preset, so
  // picking that same preset again is a change, and sends it now.
  function applyPreset(e: Event) {
    const select = e.currentTarget as HTMLSelectElement
    const value = select.value
    if (value) {
      if (lights?.preset === value) onsend(card.device)
      else onqueuelights(card.device, { preset: value })
    }
    select.value = ''
  }

  // A tap on an amber control sends its device's queued command now.
  function tapLights(on: boolean) {
    if (lights?.on === on) onsend(card.device)
    else onqueuelights(card.device, { on })
  }

  let picking = $state<{ id: string; label: string } | null>(null)

  function tap(b: { id: string; label: string }) {
    if (isQueued(queue, card.device, b.id)) onsend(card.device)
    else if (isRepeat(device, b.id)) picking = b
    else onqueuepress(card.device, b.id)
  }

  function pickTimes(n: number) {
    const id = picking?.id
    picking = null
    if (id) onqueuepress(card.device, id, n)
  }

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
    onqueuelights(card.device, { brightness: Number((e.currentTarget as HTMLInputElement).value) })
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (picking = null)} />

<section class="card">
  <h2>{device?.name ?? card.device}</h2>
  {#if view.missing}
    <p class="status">No longer available</p>
  {:else if view.waiting}
    <p class="status">Waiting for home…</p>
  {:else}
    {#if status}<p class="status">{status}</p>{/if}
    {#if device?.kind === 'lights'}
      <div class="row">
        <button class:active={device.on === true} class:queued={lights?.on === true} disabled={off} onclick={() => tapLights(true)}>On</button>
        <button class:active={device.on === false} class:queued={lights?.on === false} disabled={off} onclick={() => tapLights(false)}>Off</button>
      </div>
      {#if view.presets.length}
        <select
          class="presets"
          class:queued={lights?.preset !== undefined}
          disabled={off}
          aria-label="Preset"
          onchange={applyPreset}
        >
          <option value="">{lights?.preset ?? 'Preset…'}</option>
          {#each view.presets as p}<option value={p}>{p}</option>{/each}
        </select>
      {/if}
      <input
        type="range"
        min="1"
        max="100"
        class:queued={lights?.brightness !== undefined}
        value={lights?.brightness ?? device.brightness ?? 50}
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
          {@const queued = isQueued(queue, card.device, b.id)}
          <button class:queued disabled={off} onclick={() => tap(b)}>
            {queued && queuedTimes > 1 ? `${b.label} ×${queuedTimes}` : b.label}
          </button>
        {/each}
      </div>
      {#if picking}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="backdrop" onclick={() => (picking = null)}></div>
        <div class="popover" role="dialog" aria-label="{picking.label} times">
          <p class="title">{picking.label} · how many times?</p>
          <div class="grid">
            {#each Array.from({ length: 24 }, (_, i) => i + 1) as n}
              <button disabled={off} onclick={() => pickTimes(n)}>{n}</button>
            {/each}
          </div>
          <button class="cancel" onclick={() => (picking = null)}>Cancel</button>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .card { background: #1f2937; border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; }
  h2 { font-size: 1.1rem; margin: 0 0 10px; }
  .status { color: var(--muted); font-size: 0.9rem; margin: -6px 0 10px; }
  select.presets {
    width: 100%;
    min-height: 48px;
    margin-top: 8px;
    border: none;
    border-radius: 12px;
    background: var(--button);
    color: var(--fg);
    font-size: 1rem;
    padding: 0 12px;
  }
  select.presets:disabled { opacity: 0.5; }
  /* Queued for Apply all. Dark text keeps contrast on amber. */
  select.presets.queued { background: #f59e0b; color: #111827; font-weight: 600; }
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
  button.queued { background: #f59e0b; color: #111827; }
  button.queued:active { background: #d97706; }
  button:disabled { opacity: 0.5; }
  input[type='range'] { width: 100%; margin: 14px 0 2px; }
  input[type='range'].queued { accent-color: #f59e0b; }
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
  .backdrop { position: fixed; inset: 0; z-index: 9; }
  .popover {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    max-width: 480px;
    margin: 0 auto;
    z-index: 10;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 16px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .popover .title { margin: 0 0 10px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .grid button { min-width: 0; min-height: 44px; padding: 0; background: #374151; }
  .cancel { width: 100%; margin-top: 8px; min-height: 48px; background: #374151; }
</style>
