import type { Card, DeviceView, Layout, Page } from './api'

const mapPage = (l: Layout, id: string, f: (p: Page) => Page): Layout => ({
  ...l,
  pages: l.pages.map((p) => (p.id === id ? f(p) : p)),
})

const mapCards = (l: Layout, pageId: string, f: (cards: Card[]) => Card[]): Layout =>
  mapPage(l, pageId, (p) => ({ ...p, cards: f(p.cards) }))

export function addPage(l: Layout, name: string): { layout: Layout; id: string } {
  const id = crypto.randomUUID()
  return { layout: { pages: [...l.pages, { id, name, cards: [] }], last: id }, id }
}

export function removePage(l: Layout, id: string): Layout {
  const pages = l.pages.filter((p) => p.id !== id)
  return { pages, last: pages[0]?.id ?? null }
}

export const addCard = (l: Layout, pageId: string, device: DeviceView): Layout =>
  mapCards(l, pageId, (cards) => [
    ...cards,
    { device: device.id, picks: device.kind === 'aircon' ? device.buttons.map((b) => b.id) : [] },
  ])

export const moveCard = (l: Layout, pageId: string, index: number, delta: -1 | 1): Layout =>
  mapCards(l, pageId, (cards) => {
    const to = index + delta
    if (index < 0 || index >= cards.length || to < 0 || to >= cards.length) return cards
    const next = [...cards]
    ;[next[index], next[to]] = [next[to], next[index]]
    return next
  })

export const removeCard = (l: Layout, pageId: string, index: number): Layout =>
  mapCards(l, pageId, (cards) => cards.filter((_, i) => i !== index))

export const togglePick = (l: Layout, pageId: string, index: number, pick: string): Layout =>
  mapCards(l, pageId, (cards) =>
    cards.map((c, i) =>
      i !== index
        ? c
        : { ...c, picks: c.picks.includes(pick) ? c.picks.filter((p) => p !== pick) : [...c.picks, pick] },
    ),
  )

export const renamePage = (l: Layout, id: string, name: string): Layout =>
  mapPage(l, id, (p) => ({ ...p, name }))
