<script lang="ts">
  import type { Card, DeviceView } from './lib/api'
  import { cardView, isRepeat } from './lib/cards'

  type LightsOpts = { on?: boolean; brightness?: number; preset?: string }
  interface Props {
    card: Card
    device: DeviceView | undefined
    busy: boolean
    disabled?: boolean
    reachable?: boolean
    onpress: (device: string, button: string, times?: number) => void
    onlights: (device: string, opts: LightsOpts) => void
    onsavepreset: (device: string, name: string) => Promise<boolean>
  }
  let { card, device, busy, disabled = false, reachable = true, onpress, onlights, onsavepreset }: Props = $props()

  const view = $derived(cardView(card, device, reachable))
  const off = $derived(busy || disabled || !!device?.error)

  const status = $derived.by(() => {
    if (!device) return ''
    if (device.error) return 'Not answering right now'
    if (device.kind !== 'lights' || !reachable || device.on === null) return ''
    return device.on ? `On${device.brightness !== null ? ` · ${device.brightness}%` : ''}` : 'Off'
  })

  function applyPreset(e: Event) {
    const select = e.currentTarget as HTMLSelectElement
    if (select.value) onlights(card.device, { preset: select.value })
    select.value = ''
  }

  let picking = $state<{ id: string; label: string } | null>(null)

  function tap(b: { id: string; label: string }) {
    if (isRepeat(device, b.id)) picking = b
    else onpress(card.device, b.id)
  }

  function pickTimes(n: number) {
    const id = picking?.id
    picking = null
    if (id) onpress(card.device, id, n)
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
    onlights(card.device, { brightness: Number((e.currentTarget as HTMLInputElement).value) })
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
        <button class:active={device.on === true} disabled={off} onclick={() => onlights(card.device, { on: true })}>On</button>
        <button class:active={device.on === false} disabled={off} onclick={() => onlights(card.device, { on: false })}>Off</button>
      </div>
      {#if view.presets.length}
        <select class="presets" disabled={off} aria-label="Preset" onchange={applyPreset}>
          <option value="">Preset…</option>
          {#each view.presets as p}<option value={p}>{p}</option>{/each}
        </select>
      {/if}
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
          <button disabled={off} onclick={() => tap(b)}>{b.label}</button>
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
