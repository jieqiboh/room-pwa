<script lang="ts">
  import { onMount } from 'svelte'
  import DeviceCard from './DeviceCard.svelte'
  import PageEditor from './PageEditor.svelte'
  import { addPage, togglePick } from './lib/layout'
  import { getHouse, press, saveLayout, savePreset, setLights, SignedOut, type DeviceView, type HouseState, type Layout } from './lib/api'

  let house = $state<HouseState | null>(null)
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
    if (e instanceof SignedOut) signedOut = true
    else error = e instanceof Error ? e.message : String(e)
  }

  async function refresh() {
    try {
      house = await getHouse()
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

  const onpress = (device: string, button: string) => run(async () => { await press(device, button) })
  const onlights = (device: string, opts: { on?: boolean; brightness?: number; preset?: string }) =>
    run(async () => { await setLights(device, opts) })
  // Saves the lights as a preset, then puts its button on this card of the current page.
  const onsavepreset = (device: string, name: string) =>
    run(async () => {
      const saved = await savePreset(device, name)
      if (!house || !page) return
      const index = page.cards.findIndex((c) => c.device === device)
      if (index < 0 || page.cards[index].picks.includes(saved.name)) return
      house.layout = await saveLayout(togglePick(house.layout, page.id, index, saved.name))
    })

  let menu = $state(false)
  // The layout being edited: a copy that includes a brand-new page until it is saved.
  let editing = $state<{ layout: Layout; pageId: string } | null>(null)

  async function switchTo(id: string) {
    menu = false
    if (!house || house.layout.last === id) return
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
    editing = { layout, pageId: id }
  }

  function firstPage() {
    if (!house?.me) return
    const { layout, id } = addPage(house.layout, house.me)
    editing = { layout, pageId: id }
  }

  function editPage() {
    if (!house || !page) return
    menu = false
    editing = { layout: house.layout, pageId: page.id }
  }

  function saved(l: Layout) {
    if (house) house.layout = l
    editing = null
  }

  onMount(() => {
    refresh()
    // Phones keep the app alive in the background: refresh when it comes back.
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  })
</script>

<main>
  <header>
    {#if page && !editing}
      <button class="title" aria-expanded={menu} onclick={() => (menu = !menu)}>{page.name} ▾</button>
    {:else}
      <h1>{editing ? 'Edit page' : 'Room'}</h1>
    {/if}
    {#if house?.me}<span class="me">{house.me} · <a href="/__logout">Not {house.me}?</a></span>{/if}
  </header>

  {#if signedOut}
    <div class="banner">
      You've been signed out.
      <button class="link" onclick={() => location.reload()}>Sign in again</button>
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
        {onpress}
        {onlights}
        {onsavepreset}
      />
    {/each}
    {#if page.cards.length === 0}
      <button class="link" onclick={editPage} disabled={signedOut}>Add devices</button>
    {/if}
  {/if}

  {#if !editing}<p class="note">
    This shows the last button pressed, not the device's state. The remote moves it too.
  </p>{/if}
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
</style>
