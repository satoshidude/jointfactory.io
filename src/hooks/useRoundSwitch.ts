import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

export interface SwitchOffer {
  lifetime_joints: number
  joints: number
  sats: number
  speed_level: number
  rounds_credited: number
  points_credited: number
  max_rounds: number
  manager_price_before: number
  manager_price_after: number
  target: number
}

/**
 * Whether this account still has to confirm the switch to rounds, and the way to
 * do it.
 *
 * Read once on mount — the answer only changes when the player themselves
 * confirms, so there is nothing to poll for. `offer` is null for everyone who is
 * already playing rounds, which is every account created since they existed.
 */
export function useRoundSwitch(isLoggedIn: boolean) {
  const [offer, setOffer] = useState<SwitchOffer | null>(null)
  const [loading, setLoading] = useState(isLoggedIn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn) { setOffer(null); setLoading(false); return }
    let alive = true
    apiFetch('/game/state')
      .then(res => { if (alive) setOffer(res?.switch_offer ?? null) })
      .catch(() => { /* the game handles its own load errors */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isLoggedIn])

  const confirm = useCallback(async () => {
    if (busy) return false
    setBusy(true)
    // The server refuses a switch that does not carry this — see the route.
    const res = await apiFetch('/game/switch', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    })
    setBusy(false)
    if (res?.error) {
      setError(String(res.error))
      setTimeout(() => setError(null), 4000)
      return false
    }
    return true
  }, [busy])

  return { offer, loading, busy, error, confirm }
}
