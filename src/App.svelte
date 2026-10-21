<script lang="ts">
  import { onMount } from 'svelte'
  import { getState, press, SignedOut, type Action, type State } from './lib/api'

  let info = $state<State | null>(null)
  let busy = $state<Action | null>(null)
  let error = $state<string | null>(null)
  let signedOut = $state(false)
  let showHistory = $state(false)

  const LABELS: Record<string, string> = { up: 'Up', down: 'Down', stop: 'Stop' }

  function fail(e: unknown) {
    if (e instanceof SignedOut) signedOut = true
    else error = e instanceof Error ? e.message : String(e)
  }

  async function refresh() {
    try {
      info = await getState()
      error = info.reachable ? null : (info.error ?? null)
    } catch (e) {
      fail(e)
    }
  }

  async function send(action: Action) {
    if (busy) return
    busy = action
    error = null
    try {
      const { last } = await press(action)
      if (info) info.last = last
      navigator.vibrate?.(30)
      refresh()
    } catch (e) {
      fail(e)
    } finally {
      busy = null
    }
  }

  function when(iso: string | number): string {
    const d = new Date(iso)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
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
    <h1>Shutter</h1>
    {#if info?.me}<span class="me">{info.me} · <a href="/__logout">Not {info.me}?</a></span>{/if}
  </header>

  {#if signedOut}
    <div class="banner">
      You've been signed out.
      <button class="link" onclick={() => location.reload()}>Sign in again</button>
    </div>
  {:else if error}
    <div class="banner" role="alert">{error}</div>
  {/if}

  <div class="buttons">
    <button class="big" onclick={() => send('up')} disabled={!!busy || signedOut} aria-busy={busy === 'up'}>
      <span class="arrow">▲</span> Up
    </button>
    <button class="big stop" onclick={() => send('stop')} disabled={!!busy || signedOut} aria-busy={busy === 'stop'}>
      <span class="arrow">■</span> Stop
    </button>
    <button class="big" onclick={() => send('down')} disabled={!!busy || signedOut} aria-busy={busy === 'down'}>
      <span class="arrow">▼</span> Down
    </button>
  </div>

  <p class="last">
    {#if busy}
      Sending {LABELS[busy].toLowerCase()}…
    {:else if info?.last}
      Last sent: <strong>{LABELS[info.last.action]?.toLowerCase() ?? info.last.action}</strong>,
      {when(info.last.sent_at)}{info.last.by ? ` by ${info.last.by}` : ', not from this app'}
    {:else if info?.reachable}
      Nothing sent yet.
    {:else}
      &nbsp;
    {/if}
  </p>
  <p class="note">
    This shows the last button pressed, not where the shutter is. The wall remote moves it too.
  </p>

  {#if info?.history.length}
    <button class="link" onclick={() => (showHistory = !showHistory)}>
      {showHistory ? 'Hide' : 'Show'} recent presses
    </button>
    {#if showHistory}
      <ul class="history">
        {#each info.history as h}
          <li class:failed={!h.sent}>
            {when(h.at)} · {h.by} · {LABELS[h.action] ?? h.action}{h.sent ? '' : ' (not sent)'}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>
