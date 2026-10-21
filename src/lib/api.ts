export interface Last { action: string; sent_at: string; by: string | null }
export interface Button { id: string; label: string }
export interface Card { device: string; picks: string[] }
export interface Page { id: string; name: string; cards: Card[] }
export interface Layout { pages: Page[]; last: string | null }
export interface DeviceView {
  id: string; name: string; kind: string
  buttons: Button[]
  presets: string[]
  last_action: string | null; sent_at: string | null
  on: boolean | null; brightness: number | null; error: string | null
  by: string | null
}
export interface HouseState {
  me: string | null
  layout: Layout
  reachable: boolean
  devices: DeviceView[]
  error?: string
}

// Thrown when Access no longer lets us through: the page must reload to sign in.
export class SignedOut extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    // `manual`: an expired Access session answers with a redirect to its sign-in
    // page, which fetch cannot follow cross-origin anyway.
    res = await fetch(path, { ...init, redirect: 'manual', cache: 'no-store' })
  } catch {
    throw new Error("No connection. Check the phone's Wi-Fi or data.")
  }
  if (res.type === 'opaqueredirect' || res.status === 401) throw new SignedOut()
  const body = await res.json().catch(() => null)
  if (!body) throw new Error('Something went wrong. Try again.')
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Try again.')
  return body as T
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const getHouse = () => request<HouseState>('/api/house')

export const saveLayout = (l: Layout) => request<Layout>('/api/layout', send('PUT', l))

export const press = (device: string, button: string) =>
  request<{ last: Last }>('/api/press', send('POST', { device, button }))

export const setLights = (device: string, opts: { on?: boolean; brightness?: number; preset?: string }) =>
  request<{ done: string; note: string | null }>('/api/lights', send('POST', { device, ...opts }))

export const savePreset = (device: string, name: string) =>
  request<{ name: string }>('/api/presets', send('POST', { device, name }))
