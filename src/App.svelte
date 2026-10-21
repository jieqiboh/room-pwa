<script lang="ts">
  import { onMount } from 'svelte'
  import DeviceCard from './DeviceCard.svelte'
  import { getHouse, press, saveLayout, setLights, SignedOut, type DeviceView, type HouseState } from './lib/api'

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

  async function run(job: () => Promise<void>) {
    if (busy) return
    busy = true
    error = null
    try {
      await job()
      navigator.vibrate?.(30)
      refresh()
    } catch (e) {
      fail(e)
    } finally {
      busy = false
    }
  }

  const onpress = (device: string, button: string) => run(async () => { await press(device, button) })
  const onlights = (device: string, opts: { on?: boolean; brightness?: number; preset?: string }) =>
    run(async () => { await setLights(device, opts) })

  async function firstPage() {
    if (!house?.me) return
    try {
      const id = crypto.randomUUID()
      house.layout = await saveLayout({ pages: [{ id, name: house.me, cards: [] }], last: id })
    } catch (e) {
      fail(e)
    }
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
    <h1>{page ? `${page.name} ▾` : 'Room'}</h1>
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

  {#if house && !page}
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
      />
    {/each}
  {/if}

  <p class="note">
    This shows the last button pressed, not the device's state. The remote moves it too.
  </p>
</main>
