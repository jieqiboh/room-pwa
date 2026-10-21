export type Action = 'up' | 'down' | 'stop'

export interface Last { action: string; sent_at: string; by: string | null }
export interface HistoryItem { by: string | null; action: string; at: number; sent: boolean; error: string | null }
export interface State {
  me: string | null
  reachable: boolean
  last: Last | null
  history: HistoryItem[]
  error?: string
}

// Thrown when Access no longer lets us through: the page must reload to sign in.
export class SignedOut extends Error {}

async function request<T>(init?: RequestInit): Promise<T> {
  let res: Response
  try {
    // `manual`: an expired Access session answers with a redirect to its sign-in
    // page, which fetch cannot follow cross-origin anyway.
    res = await fetch('/api/shutter', { ...init, redirect: 'manual', cache: 'no-store' })
  } catch {
    throw new Error("No connection. Check the phone's Wi-Fi or data.")
  }
  if (res.type === 'opaqueredirect' || res.status === 401) throw new SignedOut()
  const body = await res.json().catch(() => null)
  if (!body) throw new Error('Something went wrong. Try again.')
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Try again.')
  return body as T
}

export const getState = () => request<State>()

export const press = (action: Action) =>
  request<{ last: Last }>({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
