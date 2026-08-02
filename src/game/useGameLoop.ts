import { useState, useRef, useEffect, useCallback } from 'react'
import {
  rehydrate, FREE_MANAGERS, throughput, boostMultipliers,
  courierTripTime, fabrikCycleTime, PLANTATION_DEFS,
  initialState, newPlantation, speedMultiplier,
  plantOutput, plantRate, plantEffectiveCycle, plantMilestoneInfo, plantLevelCost,
} from '../../shared/economy.js'

// ── Plantation definitions (matching production) ─────────────────────────────

export interface PlantationDef {
  id: number; name: string; icon: string
  baseProd: number; cycleTime: number
  upgBase: number; upgMult: number; mgrCost: number
  unlockCost: number
}

// Definitions live in shared/economy.js so client and server price, produce and
// reset from the same numbers. Re-exported here to keep component imports.
export { PLANTATION_DEFS }

// ── State types (production DB format) ───────────────────────────────────────

export interface PlantationState {
  id: number; name: string; icon: string
  level: number; baseProd: number; cycleTime: number
  timer: number; speed: number; speedLevel: number
  managerLevel: number; mgrCost: number
  upgBase: number; upgMult: number
  totalProduced: number
}

export interface CourierState {
  state: string  // 'idle' | 'toFactory' | 'toPlant'
  posX: number; carrying: number; capacity: number
  speed: number; speedLevel: number
  tripTimer: number; tripDuration: number
  mgrLevel: number; mgrCost: number
  capCost: number; speedCost: number
}

export interface FabrikState {
  capacity: number; speed: number; speedLevel: number
  processing: boolean; timer: number; processTime: number
  autoTimer: number
  mgrLevel: number; mgrCost: number
  capCost: number; speedCost: number
  total: number; _currentCharge: number
}

export interface ActiveBoost {
  type: string
  expires_at: number
}

/** An invite reward waiting to be collected — one per buddy, see server/auth.js. */
export interface BoostGrant {
  buddy_npub: string
  buddy_name: string
  managers: number
  required: number
  ready: boolean
  created_at: number
}

export interface GameState {
  cannabis: number
  cannabisAtFactory: number
  plantagen: PlantationState[]
  _unlockIdx: number
  courier: CourierState
  fabrik: FabrikState
  _ts: number
}

// ── Display state (for React rendering) ──────────────────────────────────────

export interface DisplayState {
  cannabis: number
  cannabisAtFactory: number
  joints: number
  sats: number
  totalJointsEarned: number
  plantagen: PlantationState[]
  courier: CourierState
  fabrik: FabrikState
  unlockIdx: number
  managerCount: number
  boosts: ActiveBoost[]
  speedLevel: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const COST_SCALE = 2.5          // courier/fabrik cap upgrade cost multiplier

// Speed levels are no longer for sale — boosts are the sats sink now. Existing
// levels keep working: `speed` still divides every cycle time, so nothing a
// player paid for is lost, there is just no way to buy more.
// scripts/season-reset.mjs still converts stored levels onto the current scale.

// ── Cost helpers (exported for UI) ───────────────────────────────────────────

// plantLevelCost comes from the shared module too — the local copy read the same
// fields, which is exactly how two formulas drift apart unnoticed.
export function plantManagerCost(p: PlantationState): number {
  return p.mgrCost
}

// ── Computed stats ───────────────────────────────────────────────────────────

// Re-exported from the shared module so components keep their import path
// while there is only one definition of each formula.
//
// plantOutput and plantRate used to be copied out here, minus the multiplier
// argument — the same duplication that once left the live site showing miners
// instead of plantations. A caller that wanted the boosted rate silently got the
// bare one.
export { courierTripTime, fabrikCycleTime, plantOutput, plantRate, plantEffectiveCycle, plantMilestoneInfo, plantLevelCost }

/**
 * Joints actually produced per second.
 *
 * This used to sum plantation rates alone, so a player without a courier or
 * factory manager reported a rate they never earned — and that number drives
 * players.joints_per_sec, the leaderboard and the growth race. throughput()
 * takes the minimum across the chain and folds in active boosts.
 */
export function totalJointsPerSec(g: GameState, boosts: ActiveBoost[] = [], speedLevel = 0): number {
  return throughput(g, { boosts, speedLevel, nowSec: Math.floor(Date.now() / 1000) }).jointsPerSec
}

// ── Initial state factory ────────────────────────────────────────────────────

// initialState/newPlantation come from the shared module so client and server
// build identical starting state.

// ── Persistence ──────────────────────────────────────────────────────────────

const SAVE_KEY = 'jf_gamestate'

const now_s = () => Math.floor(Date.now() / 1000)

const SPEED_MIGRATION_KEY = 'jf_speed_v2'
function migrateSpeedLevels(gs: GameState) {
  if (localStorage.getItem(SPEED_MIGRATION_KEY)) return
  for (const p of gs.plantagen) { p.speedLevel = 0; p.speed = 1 }
  gs.courier.speedLevel = 0; gs.courier.speed = 1
  gs.fabrik.speedLevel = 0; gs.fabrik.speed = 1
  localStorage.setItem(SPEED_MIGRATION_KEY, '1')
}

/**
 * Every path that loads a saved state runs through here. rehydrate() restores
 * the definition fields (name, icon, baseProd, upgMult …) from PLANTATION_DEFS,
 * because newPlantation() persists them into the save and they then never
 * update — the oldest account still displayed the Lightning-Mines station names
 * months after the theme changed.
 */
function hydrate(gs: GameState): GameState {
  migrateSpeedLevels(gs)
  rehydrate(gs)
  return gs
}

function saveLocal(gs: GameState) {
  gs._ts = Date.now()
  localStorage.setItem(SAVE_KEY, JSON.stringify(gs))
}

type LoadResult =
  | { status: 'ok'; gs: GameState | null; joints: number; sats: number; totalJointsEarned: number; boosts: ActiveBoost[]; grants: BoostGrant[]; speedLevel: number; jointsRev: number }
  | { status: 'no-auth' }
  | { status: 'error' }

async function loadFromServer(): Promise<LoadResult> {
  try {
    const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
    if (!auth.token) return { status: 'no-auth' }
    const res = await fetch('/api/game/state', { headers: { Authorization: `Bearer ${auth.token}` } })
    if (!res.ok) return { status: 'error' }
    const data = await res.json()
    if (!data || data.error) return { status: 'error' }
    const gs = data.gameState && Object.keys(data.gameState).length > 0 ? data.gameState as GameState : null
    if (gs) hydrate(gs)
    return {
      status: 'ok',
      gs,
      joints: data.joints ?? 0,
      sats: data.sats ?? 0,
      totalJointsEarned: data.total_joints_earned ?? 0,
      boosts: (data.boosts ?? []) as ActiveBoost[],
      grants: (data.boost_grants ?? []) as BoostGrant[],
      speedLevel: data.speed_level ?? 0,
      jointsRev: data.joints_rev ?? 0,
    }
  } catch { return { status: 'error' } }
}

let _pendingManagerSats = 0

// A buddy automating their chain unlocks a reward on someone else's account, so
// the referrer cannot learn about it from anything they do themselves. Every
// save answers with the current list, which makes the tile appear within one
// autosave interval — no extra request, no polling.
let _grantsListener: ((grants: BoostGrant[]) => void) | null = null

// The server is the authority on the balance. It clamps a figure that could not
// plausibly have been earned since the last save, and it keeps its own when a
// purchase arrived in between — but it never said so, so a client that had run
// ahead kept showing a balance the account did not have and every purchase
// failed against a number the player could see. Saves answer with the stored
// figure now, and this adopts it.
let _balanceListener: ((joints: number, rev: number) => void) | null = null

export function addManagerSatsSpent(amount: number) {
  _pendingManagerSats += amount
}

async function saveToServer(gs: GameState, joints: number, sats: number, totalJointsEarned: number, _activeBoosts: ActiveBoost[] = [], _speedLevel = 0, _jointsRev = 0) {
  try {
    const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
    if (!auth.token) return
    gs._ts = Date.now()
    const mgrSats = _pendingManagerSats
    const res = await fetch('/api/game/state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameState: gs,
        joints: Math.floor(joints),
        sats: Math.floor(sats),
        total_joints_earned: Math.floor(totalJointsEarned),
        joints_per_sec: totalJointsPerSec(gs, _activeBoosts, _speedLevel),
        manager_sats_spent: mgrSats,
        joints_rev: _jointsRev,
      }),
    })
    if (res.ok) {
      _pendingManagerSats -= mgrSats
      const data = await res.json().catch(() => null)
      if (data?.boost_grants && _grantsListener) _grantsListener(data.boost_grants as BoostGrant[])
      if (data?.corrected && typeof data.joints === 'number' && _balanceListener) {
        console.warn('[JF] Balance corrected by the server:', Math.floor(joints), '→', data.joints)
        _balanceListener(data.joints, data.joints_rev ?? 0)
      }
    }
  } catch { /* silent */ }
}

// ── Offline catch-up (speed upgrades NOT applied) ───────────────────────────

function simulateOffline(gs: GameState, elapsedSec: number, speedLevel = 0): number {
  if (elapsedSec <= 0) return 0

  // Bought speed is permanent, so it applies while away too. Boosts are
  // deliberately left out: they expire on a wall clock, so crediting them for
  // an offline stretch would pay for time the boost was not running.
  const speed = speedMultiplier(speedLevel)

  // Calculate raw production rates at speed=1 (no speed upgrades)
  let stuffPerSec = 0
  for (const p of gs.plantagen) {
    if (p.managerLevel > 0) {
      stuffPerSec += (plantOutput(p) * speed) / p.cycleTime // speed=1
    }
  }
  if (stuffPerSec === 0) return 0

  // Courier throughput at speed=1 (round trip = 2 × tripDuration)
  const c = gs.courier
  const courierRate = c.mgrLevel > 0
    ? (c.capacity * speed) / (c.tripDuration * 2) // speed=1
    : 0

  // Fabrik throughput at speed=1
  const f = gs.fabrik
  const fabrikRate = f.mgrLevel > 0
    ? (f.capacity * speed) / f.processTime // speed=1
    : 0

  // The bottleneck determines actual joints/sec
  // stuff → courier → factory → joints
  const transportRate = courierRate > 0 ? Math.min(stuffPerSec, courierRate) : 0
  const jointsPerSec = fabrikRate > 0 ? Math.min(transportRate, fabrikRate) : 0

  const jointsEarned = jointsPerSec * elapsedSec

  // Also accumulate leftover stuff that couldn't be transported
  const leftoverStuff = (stuffPerSec - transportRate) * elapsedSec
  gs.cannabis += leftoverStuff

  // Leftover transported but not processed
  const leftoverAtFactory = (transportRate - jointsPerSec) * elapsedSec
  gs.cannabisAtFactory += leftoverAtFactory

  // Reset courier to idle after offline
  gs.courier.state = 'idle'
  gs.courier.posX = 15
  gs.courier.carrying = 0
  gs.courier.tripTimer = 0

  // Reset fabrik to idle after offline
  gs.fabrik.processing = false
  gs.fabrik.timer = 0
  gs.fabrik._currentCharge = 0

  return jointsEarned
}

// ── Game Loop Hook ───────────────────────────────────────────────────────────

export function useGameLoop(
  authJoints: number,
  authSats: number,
  authJointsRev: number,
  onJointsChange?: (j: number) => void,
  onSatsChange?: (s: number) => void,
  isNewAccount?: boolean,
) {
  const gsRef = useRef<GameState>(initialState())
  const jointsRef = useRef(authJoints)
  const satsRef = useRef(authSats)
  const totalEarnedRef = useRef(0)
  const boostsRef = useRef<ActiveBoost[]>([])
  const [boostGrants, setBoostGrants] = useState<BoostGrant[]>([])
  const speedLevelRef = useRef(0)
  const jointsRevRef = useRef(0)
  const readyRef = useRef(false)
  const canSaveRef = useRef(false)
  const loggedOutRef = useRef(false) // prevents beforeunload from re-saving after logout
  const loggedInRef = useRef(!!onJointsChange) // tracks login state for game loop
  const onJointsChangeRef = useRef(onJointsChange)
  const onSatsChangeRef = useRef(onSatsChange)

  const [display, setDisplay] = useState<DisplayState>(() => makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))

  // Sync external auth values — only when saving is active and not in a transition
  const inTransitionRef = useRef(false)
  useEffect(() => {
    _grantsListener = setBoostGrants
    _balanceListener = (serverJoints: number, rev: number) => {
      jointsRef.current = serverJoints
      jointsRevRef.current = rev
      onJointsChangeRef.current?.(serverJoints)
      flush()
    }
    return () => { _grantsListener = null; _balanceListener = null }
  }, [])
  useEffect(() => { onJointsChangeRef.current = onJointsChange }, [onJointsChange])
  useEffect(() => { onSatsChangeRef.current = onSatsChange }, [onSatsChange])
  useEffect(() => { if (canSaveRef.current && !inTransitionRef.current) satsRef.current = authSats }, [authSats])
  useEffect(() => { if (canSaveRef.current && !inTransitionRef.current) jointsRef.current = authJoints }, [authJoints])
  // A ticket purchase writes the server's balance and revision into the store;
  // adopting the revision keeps the next autosave from looking stale.
  useEffect(() => { if (canSaveRef.current && authJointsRev > 0) jointsRevRef.current = authJointsRev }, [authJointsRev])

  // ── Handle login/logout transitions ──
  const wasLoggedInRef = useRef(!!onJointsChange)
  useEffect(() => {
    const isLoggedIn = !!onJointsChange

    if (wasLoggedInRef.current && !isLoggedIn) {
      // ════════════════════════════════════════════════
      // LOGOUT: Full reset, prevent any re-saving
      // ════════════════════════════════════════════════
      loggedOutRef.current = true
      loggedInRef.current = false
      canSaveRef.current = false
      readyRef.current = false
      gsRef.current = initialState()
      jointsRef.current = 0
      satsRef.current = 0
      totalEarnedRef.current = 0
      localStorage.removeItem(SAVE_KEY)
      localStorage.removeItem('jf_guest_data')
      readyRef.current = true
      setDisplay(makeDisplay(gsRef.current, 0, 0, 0))

    } else if (!wasLoggedInRef.current && isLoggedIn) {
      // ════════════════════════════════════════════════
      // LOGIN: Distinguish new vs existing account
      // ════════════════════════════════════════════════
      loggedOutRef.current = false
      loggedInRef.current = true
      readyRef.current = false
      canSaveRef.current = false
      inTransitionRef.current = true

      // Capture guest state before async load
      const guestJoints = jointsRef.current
      const guestTotal = totalEarnedRef.current
      const guestGs = gsRef.current

      if (isNewAccount) {
        // ── NEW ACCOUNT: carry over guest progress ──
        // Guest played without login, now registers for the first time.
        // Keep their game state, use server sats (initial 80).
        gsRef.current = guestGs
        jointsRef.current = guestJoints
        totalEarnedRef.current = guestTotal
        satsRef.current = authSats // server gave initial sats (80)
        onJointsChange(Math.floor(guestJoints))
        onSatsChange?.(authSats)
        saveLocal(guestGs)
        localStorage.removeItem('jf_guest_data')
        // Immediately save guest progress to server so it persists
        saveToServer(guestGs, guestJoints, authSats, guestTotal)
        inTransitionRef.current = false
        canSaveRef.current = true
        readyRef.current = true
        setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current))
      } else {
        // ── EXISTING ACCOUNT: always load from server, discard guest ──
        loadFromServer().then(result => {
          if (result.status === 'ok') {
            if (result.gs) {
              gsRef.current = result.gs
              // Offline catch-up: produce with speed=1
              const elapsed = result.gs._ts ? (Date.now() - result.gs._ts) / 1000 : 0
              if (elapsed > 2) {
                const earned = simulateOffline(gsRef.current, elapsed, result.speedLevel)
                result.joints += earned
                result.totalJointsEarned += earned
              }
            } else {
              gsRef.current = initialState()
            }
            jointsRef.current = result.joints
            satsRef.current = result.sats
            totalEarnedRef.current = result.totalJointsEarned
            boostsRef.current = result.boosts
            setBoostGrants(result.grants)
            speedLevelRef.current = result.speedLevel
        jointsRevRef.current = result.jointsRev
            jointsRevRef.current = result.jointsRev
            onJointsChange(result.joints)
            onSatsChange?.(result.sats)
            saveLocal(gsRef.current)
            canSaveRef.current = true
          } else {
            // Server error or auth failure — do NOT enable saves to protect server data
            console.warn('[JF] Login load failed:', result.status, '— server saves disabled')
            gsRef.current = initialState()
            jointsRef.current = authJoints
            satsRef.current = authSats
            totalEarnedRef.current = 0
            canSaveRef.current = false
          }
          inTransitionRef.current = false
          readyRef.current = true
          setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current))
        })
      }
    }
    wasLoggedInRef.current = isLoggedIn
  }, [onJointsChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load from server on mount (page load / refresh) ──
  useEffect(() => {
    if (canSaveRef.current) return
    loadFromServer().then(result => {
      if (canSaveRef.current) return // loaded by transition while we waited
      if (result.status === 'ok') {
        // Logged in on page load — always use server data
        if (result.gs) {
          gsRef.current = result.gs
          // Offline catch-up: produce with speed=1
          const elapsed = result.gs._ts ? (Date.now() - result.gs._ts) / 1000 : 0
          if (elapsed > 2) {
            const earned = simulateOffline(gsRef.current, elapsed, result.speedLevel)
            result.joints += earned
            result.totalJointsEarned += earned
          }
          saveLocal(result.gs)
        } else {
          gsRef.current = initialState()
        }
        jointsRef.current = result.joints
        satsRef.current = result.sats
        totalEarnedRef.current = result.totalJointsEarned
        boostsRef.current = result.boosts
        setBoostGrants(result.grants)
        speedLevelRef.current = result.speedLevel
        jointsRevRef.current = result.jointsRev
        onJointsChange?.(result.joints)
        onSatsChange?.(result.sats)
        canSaveRef.current = true
      } else if (result.status === 'error') {
        // Server/auth error — fall back to localStorage but do NOT enable server saves
        console.warn('[JF] Mount load failed — server saves disabled until next successful load')
        const saved = localStorage.getItem(SAVE_KEY)
        if (saved) {
          try {
            const gs = hydrate(JSON.parse(saved) as GameState)
            gsRef.current = gs
            const elapsed = gs._ts ? (Date.now() - gs._ts) / 1000 : 0
            if (elapsed > 2) {
              const earned = simulateOffline(gsRef.current, elapsed, speedLevelRef.current)
              jointsRef.current += earned
              totalEarnedRef.current += earned
            }
          } catch {
            gsRef.current = initialState()
          }
        } else {
          gsRef.current = initialState()
        }
        // Do NOT set canSaveRef = true — prevents overwriting server data
        canSaveRef.current = false
      } else {
        // no-auth: Guest mode — load from localStorage
        const saved = localStorage.getItem(SAVE_KEY)
        if (saved) {
          try {
            const gs = hydrate(JSON.parse(saved) as GameState)
            gsRef.current = gs
            // Offline catch-up for guests too
            const elapsed = gs._ts ? (Date.now() - gs._ts) / 1000 : 0
            if (elapsed > 2) {
              const earned = simulateOffline(gsRef.current, elapsed, speedLevelRef.current)
              jointsRef.current += earned
              totalEarnedRef.current += earned
            }
          } catch {
            gsRef.current = initialState()
          }
        } else {
          gsRef.current = initialState()
        }
        // Also load guest joints/sats from localStorage
        const guestData = localStorage.getItem('jf_guest_data')
        if (guestData) {
          try {
            const d = JSON.parse(guestData)
            jointsRef.current = d.joints ?? 0
            satsRef.current = d.sats ?? 0
            totalEarnedRef.current = d.totalEarned ?? 0
          } catch { /* ignore */ }
        }
        canSaveRef.current = true
      }
      readyRef.current = true
      setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Main game loop ──
  useEffect(() => {
    let lastTime = performance.now()
    let lastLocalSave = Date.now()
    let lastServerSave = Date.now()
    let lastRender = 0
    let animId: number

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now

      if (!readyRef.current) {
        animId = requestAnimationFrame(tick)
        return
      }

      const g = gsRef.current

      // Active boosts, recomputed each frame so one expiring takes effect at
      // once. At most four entries, so the cost is irrelevant.
      const boost = boostMultipliers(boostsRef.current, now_s())
      // Chain-wide, matching throughput(): plantation output, courier payload
      // and factory batch all scale, so the bonus is never eaten by a stage
      // that did not grow with it.
      const speed = speedMultiplier(speedLevelRef.current)

      // ── Plantations ──
      for (const p of g.plantagen) {
        const isAuto = p.managerLevel > 0
        if (isAuto || p.timer < p.cycleTime) {
          p.timer -= dt * p.speed
          while (p.timer <= 0) {
            const output = plantOutput(p) * boost.plant * speed
            g.cannabis += output
            p.totalProduced += output
            p.timer += p.cycleTime
            if (!isAuto) {
              p.timer = p.cycleTime + 0.001
              break
            }
          }
        }
      }

      // ── Courier ──
      const c = g.courier
      const tripTime = courierTripTime(c) / boost.courier

      if (c.state === 'idle') {
        if (c.mgrLevel > 0 && g.cannabis > 0) {
          c.carrying = Math.min(c.capacity * speed, g.cannabis)
          g.cannabis -= c.carrying
          c.state = 'toFactory'
          c.tripTimer = tripTime
          c.posX = 15
        }
      }

      if (c.state === 'toFactory') {
        c.tripTimer -= dt
        const progress = 1 - Math.max(0, c.tripTimer / tripTime)
        c.posX = 15 + progress * 70
        if (c.tripTimer <= 0) {
          g.cannabisAtFactory += c.carrying
          c.carrying = 0
          c.state = 'toPlant'
          c.tripTimer = tripTime
          c.posX = 85
        }
      }

      if (c.state === 'toPlant') {
        c.tripTimer -= dt
        const progress = 1 - Math.max(0, c.tripTimer / tripTime)
        c.posX = 85 - progress * 70
        if (c.tripTimer <= 0) {
          c.state = 'idle'
          c.posX = 15
          c.tripTimer = 0
        }
      }

      // ── Fabrik (The Basement) ──
      const f = g.fabrik

      if (!f.processing && f.mgrLevel > 0 && g.cannabisAtFactory > 0) {
        f._currentCharge = Math.min(f.capacity * speed, g.cannabisAtFactory)
        g.cannabisAtFactory -= f._currentCharge
        f.processing = true
        f.timer = f.processTime
      }

      if (f.processing) {
        f.timer -= dt * f.speed * boost.fabrik
        if (f.timer <= 0) {
          const produced = f._currentCharge
          jointsRef.current += produced
          totalEarnedRef.current += produced
          f.total += produced
          f._currentCharge = 0
          f.processing = false
          f.timer = 0
        }
      }

      // ── Render at ~30fps ──
      if (now - lastRender > 33) {
        setDisplay(makeDisplay(g, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current))
        lastRender = now
      }

      // ── Auto-save local every 5s ──
      if (canSaveRef.current && Date.now() - lastLocalSave > 5000) {
        saveLocal(g)
        onJointsChangeRef.current?.(Math.floor(jointsRef.current))
        // Save guest data (joints/sats) to localStorage for non-logged-in users
        if (!loggedInRef.current) {
          localStorage.setItem('jf_guest_data', JSON.stringify({
            joints: jointsRef.current,
            sats: satsRef.current,
            totalEarned: totalEarnedRef.current,
          }))
        }
        lastLocalSave = Date.now()
      }

      // ── Save to server every 30s ──
      if (canSaveRef.current && Date.now() - lastServerSave > 30000) {
        saveToServer(g, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current, jointsRevRef.current)
        lastServerSave = Date.now()
      }

      animId = requestAnimationFrame(tick)
    }

    animId = requestAnimationFrame(tick)

    // Save on page refresh/close — but NOT after logout
    const handleBeforeUnload = () => {
      if (!canSaveRef.current || loggedOutRef.current) return
      saveLocal(gsRef.current)
      // Save guest data on page close
      if (!loggedInRef.current) {
        localStorage.setItem('jf_guest_data', JSON.stringify({
          joints: jointsRef.current,
          sats: satsRef.current,
          totalEarned: totalEarnedRef.current,
        }))
      }
      try {
        const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
        if (auth.token) {
          gsRef.current._ts = Date.now()
          const mgrSats = _pendingManagerSats
          _pendingManagerSats = 0
          const beacon = JSON.stringify({
            token: auth.token,
            gameState: gsRef.current,
            joints: Math.floor(jointsRef.current),
            sats: Math.floor(satsRef.current),
            total_joints_earned: Math.floor(totalEarnedRef.current),
            joints_per_sec: totalJointsPerSec(gsRef.current, boostsRef.current, speedLevelRef.current),
            manager_sats_spent: mgrSats,
            joints_rev: jointsRevRef.current,
          })
          navigator.sendBeacon('/api/game/beacon', new Blob([beacon], { type: 'application/json' }))
        }
      } catch { /* silent */ }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (canSaveRef.current && !loggedOutRef.current) {
        saveLocal(gsRef.current)
        saveToServer(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current, jointsRevRef.current)
        onJointsChangeRef.current?.(Math.floor(jointsRef.current))
      }
      readyRef.current = false
      canSaveRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Actions ──

  const flush = useCallback(() => {
    setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current))
  }, [])

  // Redraw at once, save shortly after.
  //
  // Saving on every click would be one request per tap — a player levelling a
  // plantation ten times in five seconds would walk into the 120/min rate limit
  // and get a 429 for playing quickly. One second of coalescing keeps the state
  // on the server within a second of the screen while a burst of clicks costs a
  // single request. The unload beacon covers the tab closing inside the window.
  const saveTimerRef = useRef<number | null>(null)
  const flushAndSave = useCallback(() => {
    flush()
    if (saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      saveToServer(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current, boostsRef.current, speedLevelRef.current, jointsRevRef.current)
    }, 1000)
  }, [flush])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
  }, [])

  const grow = useCallback((index: number) => {
    const p = gsRef.current.plantagen[index]
    if (p && p.managerLevel === 0 && p.timer >= p.cycleTime) {
      p.timer = p.cycleTime - 0.001
    }
    flush()
  }, [flush])

  const sendCourier = useCallback(() => {
    const g = gsRef.current
    if (g.courier.state !== 'idle' || g.cannabis <= 0) return
    const c = g.courier
    c.carrying = Math.min(c.capacity * speedMultiplier(speedLevelRef.current), g.cannabis)
    g.cannabis -= c.carrying
    c.state = 'toFactory'
    c.tripTimer = courierTripTime(c)
    c.posX = 15
    flush()
  }, [flush])

  const rollJoints = useCallback(() => {
    const g = gsRef.current
    const f = g.fabrik
    if (f.processing || g.cannabisAtFactory <= 0) return
    f._currentCharge = Math.min(f.capacity * speedMultiplier(speedLevelRef.current), g.cannabisAtFactory)
    g.cannabisAtFactory -= f._currentCharge
    f.processing = true
    f.timer = f.processTime
    flush()
  }, [flush])

  const spendSats = useCallback((amount: number): boolean => {
    if (satsRef.current < amount) return false
    satsRef.current -= amount
    onSatsChange?.(Math.floor(satsRef.current))
    return true
  }, [onSatsChange])

  // Every joints spend below saves at once rather than waiting for the next
  // autosave.
  //
  // The window was thirty seconds, and a server-side purchase inside it undid
  // the spend for free: tickets and speed deduct from the *server's* balance and
  // answer with it, the client adopts that figure, and the local deduction is
  // gone — while the upgrade it paid for stays. Buy a courier upgrade, then a
  // lottery ticket, and the upgrade cost nothing.
  const upgradePlantLevel = useCallback((index: number) => {
    const p = gsRef.current.plantagen[index]
    if (!p) return
    const cost = plantLevelCost(p)
    if (jointsRef.current >= cost) {
      jointsRef.current -= cost
      p.level++
      flushAndSave()
    }
  }, [flushAndSave])

  const upgradeCourierCap = useCallback(() => {
    const c = gsRef.current.courier
    if (jointsRef.current >= c.capCost) {
      jointsRef.current -= c.capCost
      c.capacity *= 2
      c.capCost = Math.floor(c.capCost * COST_SCALE)
      flushAndSave()
    }
  }, [flushAndSave])

  const upgradeFabrikCap = useCallback(() => {
    const f = gsRef.current.fabrik
    if (jointsRef.current >= f.capCost) {
      jointsRef.current -= f.capCost
      f.capacity *= 2
      f.capCost = Math.floor(f.capCost * COST_SCALE)
      flushAndSave()
    }
  }, [flushAndSave])

  // Count total managers across all stations
  const countManagers = useCallback((): number => {
    const g = gsRef.current
    let count = 0
    for (const p of g.plantagen) { if (p.managerLevel > 0) count++ }
    if (g.courier.mgrLevel > 0) count++
    if (g.fabrik.mgrLevel > 0) count++
    return count
  }, [])

  const buyPlantManager = useCallback((index: number) => {
    const p = gsRef.current.plantagen[index]
    if (!p || p.managerLevel > 0) return
    const mgrs = countManagers()
    if (mgrs < FREE_MANAGERS) {
      // Free quota — matches REQUIRED_MANAGERS, so the lottery is reachable
      // without depositing bitcoin
      p.managerLevel = 1
      p.timer = 0.001
      flushAndSave()
    } else {
      // Beyond the free quota: costs sats
      const cost = p.mgrCost
      if (spendSats(cost)) {
        p.managerLevel = 1
        p.timer = 0.001
        addManagerSatsSpent(cost)
        flushAndSave()
      }
    }
  }, [spendSats, flushAndSave, countManagers])

  const buyCourierManager = useCallback(() => {
    const c = gsRef.current.courier
    if (c.mgrLevel > 0) return
    const mgrs = countManagers()
    if (mgrs < FREE_MANAGERS) {
      c.mgrLevel = 1
      flushAndSave()
    } else {
      const cost = c.mgrCost
      if (spendSats(cost)) {
        c.mgrLevel = 1
        addManagerSatsSpent(cost)
        flushAndSave()
      }
    }
  }, [spendSats, flushAndSave, countManagers])

  const buyFabrikManager = useCallback(() => {
    const f = gsRef.current.fabrik
    if (f.mgrLevel > 0) return
    const mgrs = countManagers()
    if (mgrs < FREE_MANAGERS) {
      f.mgrLevel = 1
      flushAndSave()
    } else {
      const cost = f.mgrCost
      if (spendSats(cost)) {
        f.mgrLevel = 1
        addManagerSatsSpent(cost)
        flushAndSave()
      }
    }
  }, [spendSats, flushAndSave, countManagers])

  /**
   * Buy a timed boost. The server owns the price, the deduction and the expiry
   * — this only mirrors the result so the loop can apply it immediately.
   */
  const buyBoost = useCallback(async (type: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
      if (!auth.token) return { ok: false, error: 'Log in to buy boosts' }
      const res = await fetch('/api/game/boost', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data?.error || 'Purchase failed' }
      boostsRef.current = (data.boosts ?? []) as ActiveBoost[]
      satsRef.current = data.sats ?? satsRef.current
      onSatsChangeRef.current?.(Math.floor(satsRef.current))
      flush()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }, [flush])

  /**
   * Collect the hour a buddy earned. Costs nothing — the server checks that the
   * reward exists, is unlocked and has not been taken, and starts (or extends)
   * the boost itself.
   */
  const claimBoost = useCallback(async (buddyNpub: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
      if (!auth.token) return { ok: false, error: 'Log in to claim rewards' }
      const res = await fetch('/api/game/boost/claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ buddy_npub: buddyNpub }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data?.error || 'Claim failed' }
      boostsRef.current = (data.boosts ?? []) as ActiveBoost[]
      setBoostGrants((data.boost_grants ?? []) as BoostGrant[])
      flush()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }, [flush])

  /**
   * Buy one speed step. The server owns the price — it is a share of the
   * player's own production, so the client cannot compute it from stale state.
   */
  const buySpeed = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
      if (!auth.token) return { ok: false, error: 'Log in to buy speed' }
      // Flush first, so the purchase is priced against the joints just earned.
      await saveToServer(gsRef.current, jointsRef.current, satsRef.current,
        totalEarnedRef.current, boostsRef.current, speedLevelRef.current, jointsRevRef.current)

      const res = await fetch('/api/game/speed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data?.error || 'Purchase failed' }

      speedLevelRef.current = data.level ?? speedLevelRef.current
      jointsRef.current = data.joints ?? jointsRef.current
      jointsRevRef.current = data.joints_rev ?? jointsRevRef.current
      onJointsChangeRef.current?.(Math.floor(jointsRef.current))
      flush()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }, [flush])

  const unlockPlantation = useCallback(() => {
    const g = gsRef.current
    const nextIdx = g.plantagen.length
    if (nextIdx >= PLANTATION_DEFS.length) return
    const def = PLANTATION_DEFS[nextIdx]
    if (jointsRef.current >= def.unlockCost) {
      jointsRef.current -= def.unlockCost
      g.plantagen.push(newPlantation(def))
      g._unlockIdx = nextIdx
      flushAndSave()
    }
  }, [flushAndSave])

  return {
    state: display,
    actions: {
      grow, sendCourier, rollJoints,
      upgradePlantLevel, buyPlantManager,
      upgradeCourierCap, buyCourierManager,
      upgradeFabrikCap, buyFabrikManager,
      unlockPlantation, buyBoost, buySpeed, claimBoost,
    },
    boostGrants,
  }
}

// ── Display state builder ────────────────────────────────────────────────────

function makeDisplay(g: GameState, joints: number, sats: number, totalEarned: number, boosts: ActiveBoost[] = [], speedLevel = 0): DisplayState {
  let mgrs = 0
  for (const p of g.plantagen) { if (p.managerLevel > 0) mgrs++ }
  if (g.courier.mgrLevel > 0) mgrs++
  if (g.fabrik.mgrLevel > 0) mgrs++
  return {
    cannabis: g.cannabis,
    cannabisAtFactory: g.cannabisAtFactory,
    joints,
    sats,
    totalJointsEarned: totalEarned,
    plantagen: g.plantagen.map(p => ({ ...p })),
    courier: { ...g.courier },
    fabrik: { ...g.fabrik },
    unlockIdx: g._unlockIdx,
    managerCount: mgrs,
    boosts,
    speedLevel,
  }
}
