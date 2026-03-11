import { useState, useRef, useEffect, useCallback } from 'react'

// ── Plantation definitions (matching production) ─────────────────────────────

export interface PlantationDef {
  id: number; name: string; icon: string
  baseProd: number; cycleTime: number
  upgBase: number; upgMult: number; mgrCost: number
  unlockCost: number
}

export const PLANTATION_DEFS: PlantationDef[] = [
  { id: 0, name: 'Balcony Grow',   icon: '\u{1F331}', baseProd: 5,       cycleTime: 4,   upgBase: 8,       upgMult: 1.28, mgrCost: 20,  unlockCost: 0 },
  { id: 1, name: 'Outdoor Plot',   icon: '\u{1F331}', baseProd: 60,      cycleTime: 5,   upgBase: 400,     upgMult: 1.28, mgrCost: 30,  unlockCost: 50_000 },
  { id: 2, name: 'Indoor Room',    icon: '\u{1F3E0}', baseProd: 400,     cycleTime: 4,   upgBase: 15_000,  upgMult: 1.28, mgrCost: 40,  unlockCost: 2_000_000 },
  { id: 3, name: 'Hydroponic Lab', icon: '\u{1F4A7}', baseProd: 3_000,   cycleTime: 3,   upgBase: 100_000, upgMult: 1.28, mgrCost: 60,  unlockCost: 100_000_000 },
  { id: 4, name: 'Greenhouse',     icon: '\u{1F333}', baseProd: 25_000,  cycleTime: 2.5, upgBase: 500_000, upgMult: 1.28, mgrCost: 100, unlockCost: 10_000_000_000 },
  { id: 5, name: 'MegaFarm',       icon: '\u{1F3ED}', baseProd: 250_000, cycleTime: 2,   upgBase: 2_500_000, upgMult: 1.28, mgrCost: 200, unlockCost: 1_000_000_000_000 },
]

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
}

// ── Constants ────────────────────────────────────────────────────────────────

const COST_SCALE = 2.5          // courier/fabrik cap upgrade cost multiplier

// ── Speed upgrade system: 1000 levels, 20-500 sats/level ────────────────────
export const MAX_SPEED_LEVEL = 1000

export function getSpeedUpgrade(currentLevel: number): { speed: number; cost: number; label: string } | null {
  if (currentLevel >= MAX_SPEED_LEVEL) return null
  const t = currentLevel / MAX_SPEED_LEVEL
  const cost = Math.round(20 + 480 * Math.pow(t, 0.7))
  const nextLevel = currentLevel + 1
  const maxSpeed = 8
  const speed = +(1 + (nextLevel / MAX_SPEED_LEVEL) * (maxSpeed - 1)).toFixed(2)
  const pct = Math.round((speed - 1) * 100)
  return { speed, cost, label: `+${pct}%` }
}

// ── Cost helpers (exported for UI) ───────────────────────────────────────────

export function plantLevelCost(p: PlantationState): number {
  return Math.floor(p.upgBase * Math.pow(p.upgMult, p.level))
}

export function plantSpeedCost(p: PlantationState): number {
  const next = getSpeedUpgrade(p.speedLevel)
  return next ? next.cost : 0
}

export function plantManagerCost(p: PlantationState): number {
  return p.mgrCost
}

// ── Computed stats ───────────────────────────────────────────────────────────

export function plantEffectiveCycle(p: PlantationState): number {
  return p.speed > 0 ? p.cycleTime / p.speed : p.cycleTime
}

// Milestone cycle: every 10 → x2, then 15 → x3, then 20 → x4, repeat
const MILESTONE_CYCLE = [
  { gap: 10, mult: 2 },
  { gap: 15, mult: 3 },
  { gap: 20, mult: 4 },
]

export function plantMilestoneInfo(level: number): { multiplier: number; levelsToNext: number; nextMult: number } {
  let multiplier = 1
  let remaining = level
  let cycleIdx = 0
  while (remaining >= MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length].gap) {
    const ms = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
    remaining -= ms.gap
    multiplier *= ms.mult
    cycleIdx++
  }
  const next = MILESTONE_CYCLE[cycleIdx % MILESTONE_CYCLE.length]
  return { multiplier, levelsToNext: next.gap - remaining, nextMult: next.mult }
}

export function plantOutput(p: PlantationState): number {
  const { multiplier } = plantMilestoneInfo(p.level)
  return p.level * p.baseProd * multiplier
}

export function plantRate(p: PlantationState): number {
  return plantOutput(p) / plantEffectiveCycle(p)
}

export function courierTripTime(c: CourierState): number {
  return c.speed > 0 ? c.tripDuration / c.speed : c.tripDuration
}

export function fabrikCycleTime(f: FabrikState): number {
  return f.speed > 0 ? f.processTime / f.speed : f.processTime
}

export function totalJointsPerSec(g: GameState): number {
  let rate = 0
  for (const p of g.plantagen) {
    if (p.managerLevel > 0) rate += plantRate(p)
  }
  return rate
}

// ── Initial state factory ────────────────────────────────────────────────────

function newPlantation(def: PlantationDef): PlantationState {
  return {
    id: def.id, name: def.name, icon: def.icon,
    level: 1, baseProd: def.baseProd, cycleTime: def.cycleTime,
    timer: def.cycleTime, speed: 1, speedLevel: 0,
    managerLevel: 0, mgrCost: def.mgrCost,
    upgBase: def.upgBase, upgMult: def.upgMult,
    totalProduced: 0,
  }
}

function initialState(): GameState {
  return {
    cannabis: 0,
    cannabisAtFactory: 0,
    plantagen: [newPlantation(PLANTATION_DEFS[0])],
    _unlockIdx: 0,
    courier: {
      state: 'idle', posX: 15, carrying: 0,
      capacity: 20, speed: 1, speedLevel: 0,
      tripTimer: 0, tripDuration: 4,
      mgrLevel: 0, mgrCost: 20,
      capCost: 200, speedCost: 0,
    },
    fabrik: {
      capacity: 100, speed: 1, speedLevel: 0,
      processing: false, timer: 0, processTime: 8,
      autoTimer: 0, mgrLevel: 0, mgrCost: 20,
      capCost: 400, speedCost: 0,
      total: 0, _currentCharge: 0,
    },
    _ts: Date.now(),
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

const SAVE_KEY = 'jf_gamestate'

const SPEED_MIGRATION_KEY = 'jf_speed_v2'
function migrateSpeedLevels(gs: GameState) {
  if (localStorage.getItem(SPEED_MIGRATION_KEY)) return
  for (const p of gs.plantagen) { p.speedLevel = 0; p.speed = 1 }
  gs.courier.speedLevel = 0; gs.courier.speed = 1
  gs.fabrik.speedLevel = 0; gs.fabrik.speed = 1
  localStorage.setItem(SPEED_MIGRATION_KEY, '1')
}

function saveLocal(gs: GameState) {
  gs._ts = Date.now()
  localStorage.setItem(SAVE_KEY, JSON.stringify(gs))
}

async function loadFromServer(): Promise<{ gs: GameState | null; joints: number; sats: number; totalJointsEarned: number } | null> {
  try {
    const auth = JSON.parse(localStorage.getItem('jf_auth') || '{}')
    if (!auth.token) return null
    const res = await fetch('/api/game/state', { headers: { Authorization: `Bearer ${auth.token}` } })
    const data = await res.json()
    if (!data || data.error) return null
    const gs = data.gameState && Object.keys(data.gameState).length > 0 ? data.gameState as GameState : null
    if (gs) migrateSpeedLevels(gs)
    return {
      gs,
      joints: data.joints ?? 0,
      sats: data.sats ?? 0,
      totalJointsEarned: data.total_joints_earned ?? 0,
    }
  } catch { return null }
}

let _pendingManagerSats = 0

export function addManagerSatsSpent(amount: number) {
  _pendingManagerSats += amount
}

async function saveToServer(gs: GameState, joints: number, sats: number, totalJointsEarned: number) {
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
        joints_per_sec: totalJointsPerSec(gs),
        manager_sats_spent: mgrSats,
      }),
    })
    if (res.ok) {
      _pendingManagerSats -= mgrSats
    }
  } catch { /* silent */ }
}

// ── Offline catch-up (speed upgrades NOT applied) ───────────────────────────

function simulateOffline(gs: GameState, elapsedSec: number): number {
  if (elapsedSec <= 0) return 0

  // Calculate raw production rates at speed=1 (no speed upgrades)
  let stuffPerSec = 0
  for (const p of gs.plantagen) {
    if (p.managerLevel > 0) {
      stuffPerSec += plantOutput(p) / p.cycleTime // speed=1
    }
  }
  if (stuffPerSec === 0) return 0

  // Courier throughput at speed=1 (round trip = 2 × tripDuration)
  const c = gs.courier
  const courierRate = c.mgrLevel > 0
    ? c.capacity / (c.tripDuration * 2) // speed=1
    : 0

  // Fabrik throughput at speed=1
  const f = gs.fabrik
  const fabrikRate = f.mgrLevel > 0
    ? f.capacity / f.processTime // speed=1
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
  onJointsChange?: (j: number) => void,
  onSatsChange?: (s: number) => void,
  isNewAccount?: boolean,
) {
  const gsRef = useRef<GameState>(initialState())
  const jointsRef = useRef(authJoints)
  const satsRef = useRef(authSats)
  const totalEarnedRef = useRef(0)
  const readyRef = useRef(false)
  const canSaveRef = useRef(false)
  const loggedOutRef = useRef(false) // prevents beforeunload from re-saving after logout
  const loggedInRef = useRef(!!onJointsChange) // tracks login state for game loop
  const onJointsChangeRef = useRef(onJointsChange)
  const onSatsChangeRef = useRef(onSatsChange)

  const [display, setDisplay] = useState<DisplayState>(() => makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))

  // Sync external auth values — only when saving is active and not in a transition
  const inTransitionRef = useRef(false)
  useEffect(() => { onJointsChangeRef.current = onJointsChange }, [onJointsChange])
  useEffect(() => { onSatsChangeRef.current = onSatsChange }, [onSatsChange])
  useEffect(() => { if (canSaveRef.current && !inTransitionRef.current) satsRef.current = authSats }, [authSats])
  useEffect(() => { if (canSaveRef.current && !inTransitionRef.current) jointsRef.current = authJoints }, [authJoints])

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
        setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))
      } else {
        // ── EXISTING ACCOUNT: always load from server, discard guest ──
        loadFromServer().then(result => {
          if (result) {
            if (result.gs) {
              gsRef.current = result.gs
              // Offline catch-up: produce with speed=1
              const elapsed = result.gs._ts ? (Date.now() - result.gs._ts) / 1000 : 0
              if (elapsed > 2) {
                const earned = simulateOffline(gsRef.current, elapsed)
                result.joints += earned
                result.totalJointsEarned += earned
              }
            } else {
              gsRef.current = initialState()
            }
            jointsRef.current = result.joints
            satsRef.current = result.sats
            totalEarnedRef.current = result.totalJointsEarned
            onJointsChange(result.joints)
            onSatsChange?.(result.sats)
            saveLocal(gsRef.current)
          } else {
            // Server unreachable — use auth values, fresh game state
            gsRef.current = initialState()
            jointsRef.current = authJoints
            satsRef.current = authSats
            totalEarnedRef.current = 0
          }
          inTransitionRef.current = false
          canSaveRef.current = true
          readyRef.current = true
          setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))
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
      if (result) {
        // Logged in on page load — always use server data
        if (result.gs) {
          gsRef.current = result.gs
          // Offline catch-up: produce with speed=1
          const elapsed = result.gs._ts ? (Date.now() - result.gs._ts) / 1000 : 0
          if (elapsed > 2) {
            const earned = simulateOffline(gsRef.current, elapsed)
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
        onJointsChange?.(result.joints)
        onSatsChange?.(result.sats)
        canSaveRef.current = true
      } else {
        // Guest mode: load from localStorage if available
        const saved = localStorage.getItem(SAVE_KEY)
        if (saved) {
          try {
            const gs = JSON.parse(saved) as GameState
            migrateSpeedLevels(gs)
            gsRef.current = gs
            // Offline catch-up for guests too
            const elapsed = gs._ts ? (Date.now() - gs._ts) / 1000 : 0
            if (elapsed > 2) {
              const earned = simulateOffline(gsRef.current, elapsed)
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
      setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))
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

      // ── Plantations ──
      for (const p of g.plantagen) {
        const isAuto = p.managerLevel > 0
        if (isAuto || p.timer < p.cycleTime) {
          p.timer -= dt * p.speed
          while (p.timer <= 0) {
            const output = plantOutput(p)
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
      const tripTime = courierTripTime(c)

      if (c.state === 'idle') {
        if (c.mgrLevel > 0 && g.cannabis > 0) {
          c.carrying = Math.min(c.capacity, g.cannabis)
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
        f._currentCharge = Math.min(f.capacity, g.cannabisAtFactory)
        g.cannabisAtFactory -= f._currentCharge
        f.processing = true
        f.timer = f.processTime
      }

      if (f.processing) {
        f.timer -= dt * f.speed
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
        setDisplay(makeDisplay(g, jointsRef.current, satsRef.current, totalEarnedRef.current))
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
        saveToServer(g, jointsRef.current, satsRef.current, totalEarnedRef.current)
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
            joints_per_sec: totalJointsPerSec(gsRef.current),
            manager_sats_spent: mgrSats,
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
        saveToServer(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current)
        onJointsChangeRef.current?.(Math.floor(jointsRef.current))
      }
      readyRef.current = false
      canSaveRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Actions ──

  const flush = useCallback(() => {
    setDisplay(makeDisplay(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current))
  }, [])

  const flushAndSave = useCallback(() => {
    flush()
    saveToServer(gsRef.current, jointsRef.current, satsRef.current, totalEarnedRef.current)
  }, [flush])

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
    c.carrying = Math.min(c.capacity, g.cannabis)
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
    f._currentCharge = Math.min(f.capacity, g.cannabisAtFactory)
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

  const upgradePlantLevel = useCallback((index: number) => {
    const p = gsRef.current.plantagen[index]
    if (!p) return
    const cost = plantLevelCost(p)
    if (jointsRef.current >= cost) {
      jointsRef.current -= cost
      p.level++
      flush()
    }
  }, [flush])

  const upgradeCourierCap = useCallback(() => {
    const c = gsRef.current.courier
    if (jointsRef.current >= c.capCost) {
      jointsRef.current -= c.capCost
      c.capacity *= 2
      c.capCost = Math.floor(c.capCost * COST_SCALE)
      flush()
    }
  }, [flush])

  const upgradeCourierSpeed = useCallback(() => {
    const c = gsRef.current.courier
    const next = getSpeedUpgrade(c.speedLevel)
    if (!next) return
    if (spendSats(next.cost)) {
      c.speedLevel++
      c.speed = next.speed
      addManagerSatsSpent(next.cost)
      flushAndSave()
    }
  }, [spendSats, flushAndSave])

  const upgradeFabrikCap = useCallback(() => {
    const f = gsRef.current.fabrik
    if (jointsRef.current >= f.capCost) {
      jointsRef.current -= f.capCost
      f.capacity *= 2
      f.capCost = Math.floor(f.capCost * COST_SCALE)
      flush()
    }
  }, [flush])

  const upgradeFabrikSpeed = useCallback(() => {
    const f = gsRef.current.fabrik
    const next = getSpeedUpgrade(f.speedLevel)
    if (!next) return
    if (spendSats(next.cost)) {
      f.speedLevel++
      f.speed = next.speed
      addManagerSatsSpent(next.cost)
      flushAndSave()
    }
  }, [spendSats, flushAndSave])

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
    if (mgrs < 2) {
      // First 2 managers are free
      p.managerLevel = 1
      p.timer = 0.001
      flushAndSave()
    } else {
      // 3rd+ manager costs sats
      const cost = p.mgrCost
      if (spendSats(cost)) {
        p.managerLevel = 1
        p.timer = 0.001
        addManagerSatsSpent(cost)
        flushAndSave()
      }
    }
  }, [spendSats, flushAndSave, countManagers])

  const upgradePlantSpeed = useCallback((index: number) => {
    const p = gsRef.current.plantagen[index]
    if (!p) return
    const next = getSpeedUpgrade(p.speedLevel)
    if (!next) return
    if (spendSats(next.cost)) {
      p.speedLevel++
      p.speed = next.speed
      addManagerSatsSpent(next.cost)
      flushAndSave()
    }
  }, [spendSats, flushAndSave])

  const buyCourierManager = useCallback(() => {
    const c = gsRef.current.courier
    if (c.mgrLevel > 0) return
    const mgrs = countManagers()
    if (mgrs < 2) {
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
    if (mgrs < 2) {
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

  const unlockPlantation = useCallback(() => {
    const g = gsRef.current
    const nextIdx = g.plantagen.length
    if (nextIdx >= PLANTATION_DEFS.length) return
    const def = PLANTATION_DEFS[nextIdx]
    if (jointsRef.current >= def.unlockCost) {
      jointsRef.current -= def.unlockCost
      g.plantagen.push(newPlantation(def))
      g._unlockIdx = nextIdx
      flush()
    }
  }, [flush])

  return {
    state: display,
    actions: {
      grow, sendCourier, rollJoints,
      upgradePlantLevel, upgradePlantSpeed, buyPlantManager,
      upgradeCourierCap, upgradeCourierSpeed, buyCourierManager,
      upgradeFabrikCap, upgradeFabrikSpeed, buyFabrikManager,
      unlockPlantation,
    },
  }
}

// ── Display state builder ────────────────────────────────────────────────────

function makeDisplay(g: GameState, joints: number, sats: number, totalEarned: number): DisplayState {
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
  }
}
