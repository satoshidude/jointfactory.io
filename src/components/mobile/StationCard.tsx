import { useRef, useState, useEffect } from 'react'
import { Sprout, Footprints, Factory, Lock, Cannabis } from 'lucide-react'
import type { PlantationState, CourierState, FabrikState, ActiveBoost } from '../../game/useGameLoop'
import {
  plantLevelCost, plantMilestoneInfo, plantOutput, plantEffectiveCycle, plantRate,
  courierTripTime, fabrikCycleTime,
  PLANTATION_DEFS,
} from '../../game/useGameLoop'
import { FREE_MANAGERS, boostMultipliers, prestigeMultiplier } from '../../../shared/economy.js'
import './StationCard.css'
import { fmtNum } from '../../lib/format'

// ── Animated Cycle Ring ─────────────────────────────────────────────────────

function CycleRing({ progress, speed, color, trackColor, size = 100, stroke = 5, label, onClick, disabled, ready, value, blow }: {
  progress: number; speed: number; color: string; trackColor: string; size?: number; stroke?: number
  label?: string; onClick?: () => void; disabled?: boolean; ready?: boolean; value?: string; blow?: string | null
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circ * (1 - clamped)
  const prevRef = useRef(clamped)
  const arcRef = useRef<SVGCircleElement>(null)
  const fadingRef = useRef(false)

  useEffect(() => {
    const el = arcRef.current
    if (!el) return
    const jumped = prevRef.current - clamped > 0.3
    prevRef.current = clamped

    if (jumped) {
      // Cycle reset — ring should already be fading/faded
      if (!fadingRef.current) {
        // Fallback: instant reset if fade didn't trigger
        el.style.transition = 'none'
        el.setAttribute('stroke-dashoffset', String(offset))
        el.getBoundingClientRect()
        el.style.transition = 'stroke-dashoffset 0.15s linear'
      }
      return
    }

    if (clamped > 0.97 && !fadingRef.current) {
      // Near end of cycle — snap to full, then fade out
      fadingRef.current = true
      el.style.transition = 'stroke-dashoffset 0.05s linear'
      el.setAttribute('stroke-dashoffset', '0')
      setTimeout(() => {
        el.style.transition = 'opacity 0.3s ease-out'
        el.style.opacity = '0'
        setTimeout(() => {
          // Reset to empty while invisible
          el.style.transition = 'none'
          el.setAttribute('stroke-dashoffset', String(circ))
          el.getBoundingClientRect()
          // Fade back in
          el.style.transition = 'opacity 0.2s ease-in, stroke-dashoffset 0.15s linear'
          el.style.opacity = '1'
          fadingRef.current = false
        }, 300)
      }, 100)
    } else if (!fadingRef.current) {
      el.setAttribute('stroke-dashoffset', String(offset))
    }
  })

  const glowIntensity = Math.min(1, speed / 4)
  const isClickable = onClick && !disabled

  return (
    <div
      className={`station-ring-wrap${isClickable ? ' ring-clickable' : ''}${isClickable && ready ? ' ring-ready' : ''}${disabled ? ' ring-disabled' : ''}`}
      style={{ width: size, height: size }}
      onClick={isClickable ? onClick : undefined}
    >
      <svg width={size} height={size} className="cycle-ring" style={{
        filter: `drop-shadow(0 0 ${4 + glowIntensity * 8}px ${color})`
      }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={trackColor} strokeWidth={stroke} />
        <circle ref={arcRef} cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke + glowIntensity * 2}
          strokeDasharray={circ} strokeDashoffset={circ}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.15s linear' }} />
      </svg>
      <div className="station-ring-center">
        {blow ? (
          <span className="station-ring-blow" style={{ color }}>{blow}</span>
        ) : (
          <>
            {value && <span className="station-ring-value" style={{ color }}>{value}</span>}
            {label && <span className="station-ring-label">{label}</span>}
          </>
        )}
      </div>
    </div>
  )
}

// ── Pulsing Ring (no glow, no cycle) ────────────────────────────────────────

function PulseRing({ color, trackColor, size = 100, stroke = 5, value }: {
  color: string; trackColor: string; size?: number; stroke?: number; value?: string
}) {
  const r = (size - stroke) / 2
  return (
    <div className="station-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="pulse-ring">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={trackColor} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          className="pulse-ring-stroke" />
      </svg>
      <div className="station-ring-center">
        {value && <span className="station-ring-value" style={{ color }}>{value}</span>}
      </div>
    </div>
  )
}

// ── Milestone Blow Hook ─────────────────────────────────────────────────────

function useMilestoneBlow(level: number) {
  const { multiplier } = plantMilestoneInfo(level)
  const prevMultRef = useRef(multiplier)
  const mountTimeRef = useRef(Date.now())
  const [blow, setBlow] = useState<string | null>(null)

  useEffect(() => {
    // Ignore multiplier changes in first 3s (state hydration on reload)
    if (Date.now() - mountTimeRef.current < 3000) {
      prevMultRef.current = multiplier
      return
    }
    if (multiplier > prevMultRef.current) {
      setBlow(`x${multiplier}`)
      const timer = setTimeout(() => setBlow(null), 1500)
      prevMultRef.current = multiplier
      return () => clearTimeout(timer)
    }
    prevMultRef.current = multiplier
  }, [multiplier])

  return blow
}

// ── Plant Row ───────────────────────────────────────────────────────────────

function PlantRow({ p, i, joints, managerCount, isLoggedIn, boostMult, onUpgradeLevel, onBuyManager, onGrow }: {
  p: PlantationState; i: number; joints: number; managerCount: number
  isLoggedIn: boolean; boostMult: number
  onUpgradeLevel: (i: number) => void
  onBuyManager: (i: number) => void; onGrow: (i: number) => void
}) {
  const cycle = plantEffectiveCycle(p)
  // Boosted values, so the card matches what the loop actually produces.
  const output = plantOutput(p) * boostMult
  const rate = plantRate(p) * boostMult
  const lvCost = plantLevelCost(p)
  const milestone = plantMilestoneInfo(p.level)
  const isAuto = p.managerLevel > 0
  const canAfford = joints >= lvCost
  const progress = 1 - (p.timer / p.cycleTime)
  const blow = useMilestoneBlow(p.level)

  return (
    <div className="plant-row">
      <CycleRing
        progress={progress}
        speed={p.speed}
        color="rgba(57, 255, 20, .9)"
        trackColor="rgba(57, 255, 20, .15)"
        size={88}
        stroke={4}

        value={fmtNum(output)}
        label={isAuto ? undefined : (p.timer < p.cycleTime ? '...' : 'Grow')}
        onClick={isAuto ? undefined : () => onGrow(i)}
        disabled={isAuto ? undefined : p.timer < p.cycleTime}
        ready={!isAuto && p.timer >= p.cycleTime}
        blow={blow}
      />
      <div className="plant-row-info">
        <div className="plant-row-name">{p.name}</div>
        <div className="plant-row-sub">
          {fmtNum(rate)}/s · {cycle.toFixed(1)}s · <span className="plant-row-milestone">{milestone.nextMult}x in {milestone.levelsToNext}</span>
        </div>
      </div>
      <div className="plant-row-actions">
        <button className={`station-btn station-btn-level plant-row-btn${canAfford ? '' : ' insufficient'}`}
          onClick={() => onUpgradeLevel(i)} disabled={!canAfford}>
          <span className="plant-btn-line">Lvl {p.level + 1}</span>
          <span className="plant-btn-line"><Cannabis size={12} /> {fmtNum(lvCost)}</span>
        </button>
        {!isAuto && managerCount < FREE_MANAGERS && (
          <button className="station-btn station-btn-manager station-btn-free plant-row-btn" onClick={() => onBuyManager(i)}>
            Manager — Free!
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && !isLoggedIn && (
          <button className="station-btn station-btn-manager plant-row-btn" disabled>
            Log in
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && isLoggedIn && (
          <button className="station-btn station-btn-manager plant-row-btn" onClick={() => onBuyManager(i)}>
            Manager — {p.mgrCost} sats
          </button>
        )}
      </div>
    </div>
  )
}

// ── Plantations Group Card ──────────────────────────────────────────────────

export function PlantationsCard({ plantagen, cannabis, joints, managerCount, isLoggedIn, boosts = [], seeds = 0, onUpgradeLevel, onBuyManager, onGrow, onUnlock }: {
  plantagen: PlantationState[]
  cannabis: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  boosts?: ActiveBoost[]
  seeds?: number
  onUpgradeLevel: (i: number) => void
  onBuyManager: (i: number) => void
  onGrow: (i: number) => void
  onUnlock: () => void
}) {
  // Summary stats
  // Prestige scales the whole chain, so the displayed rates have to carry it —
  // otherwise the cards understate what the loop is actually producing.
  const plantBoost = boostMultipliers(boosts, Math.floor(Date.now() / 1000)).plant * prestigeMultiplier(seeds)
  let totalRate = 0
  let totalOutput = 0
  for (const p of plantagen) {
    totalOutput += plantOutput(p)
    if (p.managerLevel > 0) totalRate += plantRate(p) * plantBoost
  }

  return (
    <div className="station-card station-plant">
      <div className="station-header">
        <Sprout size={24} className="station-header-icon" />
        <span className="station-name">Plantations</span>
        <span className="station-level">{plantagen.length} / {PLANTATION_DEFS.length}</span>
      </div>

      {/* Summary row */}
      <div className="station-card-top">
        <PulseRing
          color="rgba(57, 255, 20, .9)"
          trackColor="rgba(57, 255, 20, .15)"
          value={fmtNum(cannabis)}
        />
        <div className="station-info">
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Stock</span>
              <span className="station-stat-value" style={{ color: 'var(--neon-green)' }}>{fmtNum(cannabis)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Production</span>
              <span className="station-stat-value">{fmtNum(totalRate)}/s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Individual plant rows */}
      <div className="plant-list">
        {plantagen.map((p, i) => (
          <PlantRow key={p.id} p={p} i={i} joints={joints} managerCount={managerCount}
            isLoggedIn={isLoggedIn} boostMult={plantBoost}
            onUpgradeLevel={onUpgradeLevel}
            onBuyManager={onBuyManager} onGrow={onGrow} />
        ))}

        {/* Locked plantations */}
        {PLANTATION_DEFS.slice(plantagen.length).map((def, i) => {
          const isNext = i === 0
          return (
            <div className="plant-row plant-row-locked" key={def.id}>
              <div className="plant-locked-ring">
                <Lock size={20} />
              </div>
              <div className="plant-row-info">
                <div className="plant-row-name locked">{def.name}</div>
                <div className="plant-row-sub">{fmtNum(def.baseProd)} base · {def.cycleTime}s</div>
              </div>
              <div className="plant-row-actions">
                {isNext ? (
                  <button className={`station-btn station-btn-level plant-row-btn${joints >= def.unlockCost ? '' : ' insufficient'}`}
                    onClick={onUnlock} disabled={joints < def.unlockCost}>
                    <span className="plant-btn-line">Unlock</span>
                    <span className="plant-btn-line"><Cannabis size={12} /> {fmtNum(def.unlockCost)}</span>
                  </button>
                ) : (
                  <button className="station-btn station-btn-level plant-row-btn insufficient" disabled>
                    <span className="plant-btn-line">Unlock</span>
                    <span className="plant-btn-line"><Cannabis size={12} /> {fmtNum(def.unlockCost)}</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Courier Station Card ────────────────────────────────────────────────────

export function CourierCard({ courier, cannabis, joints, managerCount, isLoggedIn, boosts = [], seeds = 0, onUpgradeCap, onBuyManager, onSend }: {
  courier: CourierState
  cannabis: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  boosts?: ActiveBoost[]
  seeds?: number
  onUpgradeCap: () => void
  onBuyManager: () => void
  onSend: () => void
}) {
  const tripTime = courierTripTime(courier, boostMultipliers(boosts, Math.floor(Date.now() / 1000)).courier)
  // The loop hauls capacity x prestige per trip; show that, not the raw number.
  const payload = courier.capacity * prestigeMultiplier(seeds)
  const isMoving = courier.state !== 'idle'
  const rawProgress = isMoving ? 1 - (courier.tripTimer / tripTime) : 0
  const progress = courier.state === 'toPlant' ? 1 - rawProgress : rawProgress
  const isAuto = courier.mgrLevel > 0
  const canSend = courier.state === 'idle' && cannabis > 0

  return (
    <div className="station-card station-courier">
      <div className="station-header">
        <Footprints size={24} className="station-header-icon" />
        <span className="station-name">Courier</span>
      </div>

      <div className="station-card-top">
        <CycleRing
          progress={progress}
          speed={courier.speed}
          color="rgba(255, 105, 180, .9)"
          trackColor="rgba(255, 105, 180, .15)"

          value={courier.state === 'toPlant' ? 'rest' : isMoving ? fmtNum(courier.carrying) : fmtNum(payload)}
          label={isAuto ? undefined : (isMoving ? 'En route...' : 'Send')}
          onClick={isAuto ? undefined : onSend}
          disabled={isAuto ? undefined : !canSend}
          ready={!isAuto && canSend}
        />
        <div className="station-info">
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Capacity</span>
              <span className="station-stat-value" style={{ color: '#ff69b4' }}>{fmtNum(payload)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Trip</span>
              <span className="station-stat-value">{tripTime.toFixed(1)}s</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Waiting</span>
              <span className="station-stat-value" style={{ color: 'var(--neon-green)' }}>{fmtNum(cannabis)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="station-actions">
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < courier.capCost}>
          Cap x2 — <Cannabis size={12} /> {fmtNum(courier.capCost)}
        </button>
        {!isAuto && managerCount < FREE_MANAGERS && (
          <button className="station-btn station-btn-manager station-btn-free" onClick={onBuyManager}>
            Hire Manager — Free!
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && !isLoggedIn && (
          <button className="station-btn station-btn-manager" disabled>
            Log in to hire more
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && isLoggedIn && (
          <button className="station-btn station-btn-manager" onClick={onBuyManager}>
            Hire Manager — {courier.mgrCost} sats
          </button>
        )}
      </div>
    </div>
  )
}

// ── Factory Station Card ────────────────────────────────────────────────────

export function FactoryCard({ fabrik, courier, cannabisAtFactory, joints, managerCount, isLoggedIn, boosts = [], seeds = 0, onUpgradeCap, onBuyManager, onRoll }: {
  fabrik: FabrikState
  courier: CourierState
  cannabisAtFactory: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  boosts?: ActiveBoost[]
  seeds?: number
  onUpgradeCap: () => void
  onBuyManager: () => void
  onRoll: () => void
}) {
  const mult = boostMultipliers(boosts, Math.floor(Date.now() / 1000))
  const cycleTime = fabrikCycleTime(fabrik, mult.fabrik)
  const batch = fabrik.capacity * prestigeMultiplier(seeds)

  // Can the courier keep the factory fed? Comparing throughput rather than the
  // momentary stock, which swings with every batch and would flicker.
  const intake = courier.mgrLevel > 0
    ? (courier.capacity * prestigeMultiplier(seeds)) / (2 * courierTripTime(courier, mult.courier))
    : 0
  const demand = fabrik.mgrLevel > 0 ? batch / cycleTime : 0
  const starved = demand > 0 && intake < demand
  const progress = fabrik.processing ? 1 - (fabrik.timer / fabrik.processTime) : 0
  const isAuto = fabrik.mgrLevel > 0
  const canRoll = !fabrik.processing && cannabisAtFactory > 0

  return (
    <div className="station-card station-factory">
      <div className="station-header">
        <Factory size={24} className="station-header-icon" />
        <span className="station-name">Factory</span>
      </div>

      <div className="station-card-top">
        <CycleRing
          progress={progress}
          speed={fabrik.speed}
          color="rgba(204, 68, 255, .9)"
          trackColor="rgba(204, 68, 255, .15)"

          value={fabrik.processing ? fmtNum(fabrik._currentCharge) : fmtNum(batch)}
          label={isAuto ? undefined : (fabrik.processing ? 'Rolling...' : 'Roll')}
          onClick={isAuto ? undefined : onRoll}
          disabled={isAuto ? undefined : !canRoll}
          ready={!isAuto && canRoll}
        />
        <div className="station-info">
          <div className="station-stats">
            {/* Weed the courier has delivered, against what one batch eats.
                Below the batch size means the next run is only partly filled,
                so the chain is readable end to end: the courier card shows what
                is still out in the fields, this shows what made it here. */}
            <div className="station-stat-row">
              <span className="station-stat-label">Stock</span>
              <span className="station-stat-value" style={{ color: starved ? 'var(--neon-gold)' : 'var(--neon-green)' }}>
                <Cannabis size={12} /> {fmtNum(cannabisAtFactory)}
                <span className="station-stat-of"> / {fmtNum(batch)}</span>
              </span>
            </div>
            {starved && (
              <div className="station-stat-row">
                <span className="station-stat-label station-stat-warn">
                  Courier delivers {fmtNum(intake)}/s, factory eats {fmtNum(demand)}/s
                </span>
              </div>
            )}
            <div className="station-stat-row">
              <span className="station-stat-label">Processing</span>
              <span className="station-stat-value" style={{ color: 'var(--neon-purple)' }}>{fmtNum(fabrik._currentCharge)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Cycle</span>
              <span className="station-stat-value">{cycleTime.toFixed(1)}s</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Total</span>
              <span className="station-stat-value" style={{ color: 'var(--neon-green)' }}><Cannabis size={12} /> {fmtNum(fabrik.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="station-actions">
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < fabrik.capCost}>
          Cap x2 — <Cannabis size={12} /> {fmtNum(fabrik.capCost)}
        </button>
        {!isAuto && managerCount < FREE_MANAGERS && (
          <button className="station-btn station-btn-manager station-btn-free" onClick={onBuyManager}>
            Hire Manager — Free!
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && !isLoggedIn && (
          <button className="station-btn station-btn-manager" disabled>
            Log in to hire more
          </button>
        )}
        {!isAuto && managerCount >= FREE_MANAGERS && isLoggedIn && (
          <button className="station-btn station-btn-manager" onClick={onBuyManager}>
            Hire Manager — {fabrik.mgrCost} sats
          </button>
        )}
      </div>
    </div>
  )
}
