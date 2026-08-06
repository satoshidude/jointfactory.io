/**
 * One tab, one session — and only the newest one owns the account.
 *
 * Two clients on the same account both simulate the chain and both write their
 * own view of it. The save guard then clamps each against what the other stored,
 * and an upgrade bought in one is unknown to the other, which buys it again: one
 * account paid for the same capacity step nine times in an hour and had 137
 * million joints clamped away across 83 saves.
 *
 * The id is per page load, not per login. Two tabs on one machine share a token,
 * so a login-scoped id would not tell them apart — and they are exactly the case
 * that goes unnoticed.
 */

export const SESSION_ID: string =
  globalThis.crypto?.randomUUID?.() ?? `s${Date.now()}${Math.random().toString(36).slice(2)}`

export const SESSION_HEADER = 'X-JF-Session'

let master = true
const listeners = new Set<(isMaster: boolean) => void>()

export function isMaster() { return master }

/** Called when a save comes back refused because another client took over. */
export function loseMaster() {
  if (!master) return
  master = false
  for (const l of listeners) l(false)
}

/** Take the account back. The other client finds out on its next save. */
export async function claimMaster(): Promise<boolean> {
  const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
  if (!auth.token) return false
  try {
    const res = await fetch('/api/game/claim', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
        [SESSION_HEADER]: SESSION_ID,
      },
    })
    if (!res.ok) return false
    master = true
    for (const l of listeners) l(true)
    return true
  } catch {
    return false
  }
}

export function subscribeMaster(cb: (isMaster: boolean) => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
