<script lang="ts">
  import { onMount } from 'svelte'
  import DeviceCard from './DeviceCard.svelte'
  import PageEditor from './PageEditor.svelte'
  import { addPage } from './lib/layout'
  import { applyBatch, getHouse, press, saveLayout, savePreset, setLights, SignedOut, type DeviceView, type HouseState, type Layout } from './lib/api'
  import { commands, firstError, queueLights, queuePress, remove, settle, type LightsChange, type Queue } from './lib/queue'

  // The last house this phone saw, so the page draws at once; refresh() replaces it.
  const HOUSE_KEY = 'room-house'
  function readHouse(): HouseState | null {
    try {
      const v = JSON.parse(localStorage.getItem(HOUSE_KEY) ?? 'null')
      return v?.layout && Array.isArray(v.devices) ? v : null
    } catch {
      return null
    }
  }
  function forgetHouse() {
    try {
      localStorage.removeItem(HOUSE_KEY)
    } catch { /* storage unavailable */ }
  }

  let house = $state<HouseState | null>(readHouse())
  let fresh = $state(false)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let signedOut = $state(false)

  const CACHE_KEY = 'room-devices'
  function readCache(): DeviceView[] {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  function writeCache(d: DeviceView[]) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(d))
    } catch { /* storage unavailable: nothing to cache */ }
  }
  let cached = $state<DeviceView[]>(readCache())
  const devices = $derived(house?.reachable ? house.devices : cached)

  const page = $derived(
    house ? (house.layout.pages.find((p) => p.id === house!.layout.last) ?? house.layout.pages[0]) : undefined,
  )

  function fail(e: unknown) {
    if (e instanceof SignedOut) {
      signedOut = true
      forgetHouse()
      // Opened signed out (the page itself comes from the service worker): straight to sign-in.
      if (!fresh) location.href = '/__login'
    }
    else error = e instanceof Error ? e.message : String(e)
  }

  async function refresh() {
    try {
      const shown = page?.id
      house = await getHouse()
      // Another device switched this person's page: the queue was for the old one.
      if (shown !== undefined && page?.id !== shown) queue = {}
      fresh = true
      error = house.reachable ? null : (house.error ?? null)
      if (house.reachable) {
        cached = house.devices
        writeCache(house.devices)
      }
    } catch (e) {
      fail(e)
    }
  }

  async function run(job: () => Promise<void>): Promise<boolean> {
    if (busy) return false
    busy = true
    error = null
    try {
      await job()
      navigator.vibrate?.(30)
      refresh()
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      busy = false
    }
  }

  // Taps queue a command per device; Apply all sends them together. Kept only while on this page.
  let queue = $state<Queue>({})
  const queuedCount = $derived(commands(queue).length)

  const onqueuepress = (device: string, button: string, times = 1) => {
    if (!busy) queue = queuePress(queue, device, button, times)
  }
  const onqueuelights = (device: string, change: LightsChange) => {
    if (!busy) queue = queueLights(queue, device, change)
  }
  // Tapping a queued (amber) control sends that device's command now, by itself.
  const onsend = (device: string) => {
    const c = queue[device]
    if (!c) return
    run(async () => {
      if (c.kind === 'press') await press(device, c.button, c.times)
      else await setLights(device, { on: c.on, brightness: c.brightness, preset: c.preset })
      queue = remove(queue, device)
    })
  }

  async function applyAll() {
    if (busy || queuedCount === 0 || !house?.reachable) return
    busy = true
    error = null
    let bad: string | null = null
    try {
      const { results } = await applyBatch(commands(queue))
      queue = settle(queue, results)
      bad = firstError(results)
      if (bad) error = bad
      else navigator.vibrate?.(30)
    } catch (e) {
      fail(e)
      return
    } finally {
      busy = false
    }
    await refresh()
    if (bad) error = bad
  }
  // Saves the lights as a preset, then puts its button on this card of the current page.
  const onsavepreset = (device: string, name: string) =>
    run(async () => { await savePreset(device, name) })

  let menu = $state(false)
  // The layout being edited: a copy that includes a brand-new page until it is saved.
  let editing = $state<{ layout: Layout; pageId: string } | null>(null)

  async function switchTo(id: string) {
    menu = false
    if (!house || house.layout.last === id) return
    queue = {}
    const before = house.layout
    house.layout = { ...before, last: id }
    try {
      house.layout = await saveLayout(house.layout)
    } catch (e) {
      house.layout = before
      fail(e)
    }
  }

  function newPage() {
    if (!house) return
    menu = false
    const name = `Page ${house.layout.pages.length + 1}`
    const { layout, id } = addPage(house.layout, name)
    queue = {}
    editing = { layout, pageId: id }
  }

  function firstPage() {
    if (!house?.me) return
    const { layout, id } = addPage(house.layout, house.me)
    queue = {}
    editing = { layout, pageId: id }
  }

  function editPage() {
    if (!house || !page) return
    menu = false
    queue = {}
    editing = { layout: house.layout, pageId: page.id }
  }

  function saved(l: Layout) {
    if (house) house.layout = l
    editing = null
  }

  $effect(() => {
    if (!fresh || !house?.reachable) return
    const snapshot = JSON.stringify(house)
    try {
      localStorage.setItem(HOUSE_KEY, snapshot)
    } catch { /* storage unavailable: nothing to cache */ }
  })

  onMount(() => {
    refresh()
    // Phones keep the app alive in the background: refresh when it comes back.
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  })
</script>

<main class:queued={queuedCount > 0 && !editing}>
  <header>
    {#if page && !editing}
      <button class="title" aria-expanded={menu} onclick={() => (menu = !menu)}>{page.name} ▾</button>
    {:else}
      <h1>{editing ? 'Edit page' : 'Room'}</h1>
    {/if}
    {#if house?.me}<span class="me">{house.me} · <a href="/__logout" onclick={forgetHouse}>Not {house.me}?</a></span>{/if}
    {#if house && !fresh && !signedOut}<span class="me">Updating…</span>{/if}
  </header>

  {#if signedOut}
    <div class="banner">
      You've been signed out.
      <button class="link" onclick={() => (location.href = '/__login')}>Sign in again</button>
    </div>
  {:else if error}
    <div class="banner" role="alert">{error}</div>
  {/if}

  {#if menu && house}
    <button class="scrim" aria-label="Close menu" onclick={() => (menu = false)}></button>
    <div class="menu" role="menu">
      {#each house.layout.pages as p (p.id)}
        <button role="menuitem" onclick={() => switchTo(p.id)}>
          <span>{p.name}</span>{#if p.id === page?.id}<span>✓</span>{/if}
        </button>
      {/each}
      <hr />
      <button role="menuitem" class="act" disabled={signedOut} onclick={newPage}>＋ New page</button>
      <button role="menuitem" class="act" disabled={signedOut || !page} onclick={editPage}>✎ Edit this page</button>
    </div>
  {/if}

  {#if editing && house}
    <PageEditor
      layout={editing.layout}
      pageId={editing.pageId}
      {devices}
      reachable={house.reachable}
      onsave={saved}
      oncancel={() => (editing = null)}
    />
  {:else if house && !page}
    <button class="link" onclick={firstPage} disabled={signedOut}>Make your first page</button>
  {:else if page}
    {#each page.cards as card (card.device)}
      <DeviceCard
        {card}
        device={devices.find((d) => d.id === card.device)}
        reachable={!!house?.reachable}
        {busy}
        disabled={signedOut || !house?.reachable}
        {queue}
        {onqueuepress}
        {onqueuelights}
        {onsend}
        {onsavepreset}
      />
    {/each}
    {#if page.cards.length === 0}
      <button class="link" onclick={editPage} disabled={signedOut}>Add devices</button>
    {/if}
    {#if queuedCount > 0 && !menu}
      <div class="applybar">
        <button class="apply" disabled={busy || signedOut || !house?.reachable} onclick={applyAll}>Apply all ({queuedCount})</button>
        <button class="clear" disabled={busy} onclick={() => (queue = {})}>Clear</button>
      </div>
    {/if}
  {/if}
</main>

<style>
  .title {
    background: none;
    border: none;
    color: var(--fg);
    font-size: 1.5rem;
    font-weight: 700;
    padding: 0;
    margin: 0 0 12px;
    min-height: 44px;
    cursor: pointer;
    position: relative;
    z-index: 2;
  }
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); border: none; z-index: 1; }
  .menu {
    position: relative;
    z-index: 2;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 14px;
    padding: 6px;
    margin-bottom: 12px;
  }
  .menu button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    min-height: 48px;
    align-items: center;
    background: none;
    border: none;
    border-radius: 10px;
    color: var(--fg);
    font-size: 1rem;
    padding: 0 12px;
    cursor: pointer;
  }
  .menu button:active { background: var(--button); }
  .menu button.act { color: #60a5fa; }
  .menu button:disabled { opacity: 0.5; }
  .menu hr { border: none; border-top: 1px solid #374151; margin: 6px 0; }
  /* Room below the last card for the apply bar. */
  main.queued { padding-bottom: calc(env(safe-area-inset-bottom) + 96px); }
  .applybar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5; /* under the repeat sheet (9, 10) */
    display: flex;
    gap: 8px;
    max-width: 480px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: 12px 16px calc(env(safe-area-inset-bottom) + 12px);
    background: var(--bg);
    border-top: 1px solid #374151;
  }
  .applybar button {
    min-height: 48px;
    border: none;
    border-radius: 12px;
    color: var(--fg);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .applybar .apply { flex: 2 1 0; background: #2563eb; }
  .applybar .clear { flex: 1 1 0; background: var(--button); }
  .applybar button:active { filter: brightness(1.15); }
  .applybar button:disabled { opacity: 0.5; }
</style>
