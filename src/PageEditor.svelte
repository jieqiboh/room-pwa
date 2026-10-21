<script lang="ts">
  import { saveLayout, SignedOut, type DeviceView, type Layout } from './lib/api'
  import { addCard, moveCard, removeCard, removePage, renamePage, togglePick } from './lib/layout'

  interface Props {
    layout: Layout
    pageId: string
    devices: DeviceView[]
    reachable?: boolean
    onsave: (layout: Layout) => void
    oncancel: () => void
  }
  let { layout, pageId, devices, reachable = true, onsave, oncancel }: Props = $props()

  // svelte-ignore state_referenced_locally
  let draft = $state<Layout>(structuredClone($state.snapshot(layout)))
  let saving = $state(false)
  let error = $state<string | null>(null)
  let confirmDelete = $state(false)

  const page = $derived(draft.pages.find((p) => p.id === pageId))
  const free = $derived(devices.filter((d) => !page?.cards.some((c) => c.device === d.id)))
  const kinds = $derived([...new Set(free.map((d) => d.kind))])
  const find = (id: string) => devices.find((d) => d.id === id)
  const canSave = $derived(!saving && (!page || page.name.trim() !== ''))

  async function save(next: Layout) {
    if (saving) return
    saving = true
    error = null
    try {
      onsave(await saveLayout(next))
    } catch (e) {
      error =
        e instanceof SignedOut
          ? "You've been signed out. Reload to sign in again."
          : e instanceof Error ? e.message : String(e)
      saving = false
    }
  }

  function onSave() {
    if (!page) return
    save(renamePage(draft, pageId, page.name.trim()))
  }

  function onDelete() {
    if (!confirmDelete) {
      confirmDelete = true
      return
    }
    save(removePage(draft, pageId))
  }
</script>

<div class="editor">
  {#if page}
    <label class="field">
      <span>Page name</span>
      <input type="text" value={page.name} maxlength="40" oninput={(e) => (draft = renamePage(draft, pageId, e.currentTarget.value))} />
    </label>

    <h3>Devices on this page</h3>
    {#each page.cards as card, i (card.device)}
      {@const d = find(card.device)}
      <section class="card">
        <div class="head">
          <span class="name">{d?.name ?? card.device}</span>
          <button class="small" aria-label="Move up" disabled={i === 0} onclick={() => (draft = moveCard(draft, pageId, i, -1))}>↑</button>
          <button class="small" aria-label="Move down" disabled={i === page.cards.length - 1} onclick={() => (draft = moveCard(draft, pageId, i, 1))}>↓</button>
          <button class="small" aria-label="Remove" onclick={() => (draft = removeCard(draft, pageId, i))}>✕</button>
        </div>
        {#if d?.kind === 'aircon'}
          {#each d.buttons as b}
            <label class="pick">
              <input type="checkbox" checked={card.picks.includes(b.id)} onchange={() => (draft = togglePick(draft, pageId, i, b.id))} />
              {b.label}
            </label>
          {/each}
        {:else if d?.kind === 'lights'}
          {#each d.presets as p}
            <label class="pick">
              <input type="checkbox" checked={card.picks.includes(p)} onchange={() => (draft = togglePick(draft, pageId, i, p))} />
              {p}
            </label>
          {/each}
        {/if}
      </section>
    {:else}
      <p class="muted">No devices yet.</p>
    {/each}

    <h3>Add a device</h3>
    {#if !reachable}
      <p class="muted">Can't reach home, so the device list isn't available.</p>
    {:else if free.length === 0}
      <p class="muted">Every device is already on this page.</p>
    {:else}
      {#each kinds as kind}
        <div class="kind">{kind}</div>
        <div class="chips">
          {#each free.filter((d) => d.kind === kind) as d (d.id)}
            <button class="chip" onclick={() => (draft = addCard(draft, pageId, d))}>＋ {d.name}</button>
          {/each}
        </div>
      {/each}
    {/if}

    {#if error}<div class="banner" role="alert">{error}</div>{/if}

    <div class="actions">
      <button class="cancel" disabled={saving} onclick={oncancel}>Cancel</button>
      <button class="save" disabled={!canSave} onclick={onSave}>Save</button>
    </div>

    <button class="delete" disabled={saving} onclick={onDelete}>
      {confirmDelete ? 'Tap again to delete' : 'Delete this page'}
    </button>
  {/if}
</div>

<style>
  .field { display: block; margin-bottom: 16px; }
  .field span { display: block; color: var(--muted); font-size: 0.85rem; margin-bottom: 6px; }
  input[type='text'] {
    width: 100%;
    min-height: 48px;
    border: 1px solid #374151;
    border-radius: 12px;
    background: #1f2937;
    color: var(--fg);
    font-size: 1rem;
    padding: 0 14px;
    -webkit-user-select: text;
    user-select: text;
  }
  h3 { font-size: 0.85rem; color: var(--muted); font-weight: 600; margin: 18px 0 8px; }
  .card { background: #1f2937; border-radius: 16px; padding: 8px 12px; margin-bottom: 10px; }
  .head { display: flex; align-items: center; gap: 6px; }
  .name { flex: 1; font-weight: 600; }
  button { border: none; color: var(--fg); font-size: 1rem; cursor: pointer; }
  button:disabled { opacity: 0.4; }
  .small { width: 44px; height: 44px; border-radius: 12px; background: var(--button); font-weight: 600; }
  .small:active { background: var(--button-active); }
  .pick { display: flex; align-items: center; gap: 12px; min-height: 44px; }
  .pick input { width: 22px; height: 22px; }
  .muted { color: var(--muted); font-size: 0.9rem; margin: 0 0 8px; }
  .kind { color: var(--muted); font-size: 0.8rem; text-transform: capitalize; margin: 8px 0 6px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { min-height: 44px; padding: 0 14px; border-radius: 12px; background: none; border: 1px dashed #4b5563; }
  .chip:active { background: var(--button); }
  .actions { display: flex; gap: 10px; margin: 22px 0 8px; }
  .actions button { flex: 1; min-height: 52px; border-radius: 12px; font-weight: 600; background: var(--button); }
  .actions .save { background: #2563eb; }
  .delete { display: block; margin: 8px auto 0; min-height: 48px; background: none; color: #f87171; }
</style>
