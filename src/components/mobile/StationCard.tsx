import { useRef } from 'react'
import { Sprout, Footprints, Factory, Lock } from 'lucide-react'
import type { PlantationState, CourierState, FabrikState } from '../../game/useGameLoop'
import {
  plantLevelCost, plantMilestoneInfo, plantOutput, plantEffectiveCycle, plantRate,
  courierTripTime, fabrikCycleTime,
  getSpeedUpgrade, PLANTATION_DEFS,
} from '../../game/useGameLoop'
import './StationCard.css'

function fmtNum(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.floor(n).toLocaleString()
}

// ── Animated Cycle Ring ─────────────────────────────────────────────────────

function CycleRing({ progress, speed, color, trackColor, size = 100, stroke = 5, label, onClick, disabled, ready, value }: {
  progress: number; speed: number; color: string; trackColor: string; size?: number; stroke?: number
  label?: string; onClick?: () => void; disabled?: boolean; ready?: boolean; value?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circ * (1 - clamped)
  const prevRef = useRef(clamped)
  const flashRef = useRef(0)

  if (prevRef.current > 0.7 && clamped < 0.3) {
    flashRef.current++
  }
  prevRef.current = clamped

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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke + glowIntensity * 2}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.05s linear' }} />
        <circle key={flashRef.current} cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="cycle-ring-flash" />
      </svg>
      <div className="station-ring-center">
        {value && <span className="station-ring-value" style={{ color }}>{value}</span>}
        {label && <span className="station-ring-label">{label}</span>}
      </div>
    </div>
  )
}

// ── Plantations Group Card ──────────────────────────────────────────────────

export function PlantationsCard({ plantagen, cannabis, joints, managerCount, isLoggedIn, totalDeposited, onUpgradeLevel, onUpgradeSpeed, onBuyManager, onGrow, onUnlock }: {
  plantagen: PlantationState[]
  cannabis: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  totalDeposited: number
  onUpgradeLevel: (i: number) => void
  onUpgradeSpeed: (i: number) => void
  onBuyManager: (i: number) => void
  onGrow: (i: number) => void
  onUnlock: () => void
}) {
  // Summary stats
  let totalRate = 0
  for (const p of plantagen) {
    if (p.managerLevel > 0) totalRate += plantRate(p)
  }

  return (
    <div className="station-card station-plant">
      <div className="station-header">
        <Sprout size={20} className="station-header-icon" />
        <span className="station-name">Plantations</span>
        <span className="station-level">{plantagen.length} / {PLANTATION_DEFS.length}</span>
      </div>

      {/* Summary row */}
      <div className="station-card-top">
        <CycleRing
          progress={plantagen.length > 0 ? 1 - (plantagen[0].timer / plantagen[0].cycleTime) : 0}
          speed={plantagen.length > 0 ? plantagen[0].speed : 1}
          color="rgba(57, 255, 20, .9)"
          trackColor="rgba(57, 255, 20, .15)"
          value={fmtNum(cannabis)}
        />
        <div className="station-info">
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Stock</span>
              <span className="station-stat-value">{fmtNum(cannabis)}</span>
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
        {plantagen.map((p, i) => {
          const cycle = plantEffectiveCycle(p)
          const output = plantOutput(p)
          const rate = plantRate(p)
          const lvCost = plantLevelCost(p)
          const milestone = plantMilestoneInfo(p.level)
          const speedUpg = getSpeedUpgrade(p.speedLevel)
          const isAuto = p.managerLevel > 0
          const canAfford = joints >= lvCost
          const progress = 1 - (p.timer / p.cycleTime)

          return (
            <div className="plant-row" key={p.id}>
              <CycleRing
                progress={progress}
                speed={p.speed}
                color="rgba(57, 255, 20, .9)"
                trackColor="rgba(57, 255, 20, .15)"
                size={58}
                stroke={3}
                value={fmtNum(output)}
                label={isAuto ? undefined : (p.timer < p.cycleTime ? '...' : 'Grow')}
                onClick={isAuto ? undefined : () => onGrow(i)}
                disabled={isAuto ? undefined : p.timer < p.cycleTime}
                ready={!isAuto && p.timer >= p.cycleTime}
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
                  Lvl {p.level + 1} — {fmtNum(lvCost)}
                </button>
                {!isAuto && managerCount < 2 && (
                  <button className="station-btn station-btn-manager station-btn-free plant-row-btn" onClick={() => onBuyManager(i)}>
                    Manager — Free!
                  </button>
                )}
                {!isAuto && managerCount >= 2 && (!isLoggedIn || totalDeposited < 50) && (
                  <button className="station-btn station-btn-manager plant-row-btn" disabled>
                    {!isLoggedIn ? 'Login + 50 sats' : `${50 - totalDeposited} more sats`}
                  </button>
                )}
                {!isAuto && managerCount >= 2 && isLoggedIn && totalDeposited >= 50 && (
                  <button className="station-btn station-btn-manager plant-row-btn" onClick={() => onBuyManager(i)}>
                    Manager — {p.mgrCost} sats
                  </button>
                )}
                {speedUpg && isAuto && (
                  <button className="station-btn station-btn-speed plant-row-btn" onClick={() => onUpgradeSpeed(i)}>
                    Speed {speedUpg.label} — {speedUpg.cost} sats
                  </button>
                )}
              </div>
            </div>
          )
        })}

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
                  <button className="station-btn station-btn-level plant-row-btn"
                    onClick={onUnlock} disabled={joints < def.unlockCost}>
                    Unlock — {fmtNum(def.unlockCost)}
                  </button>
                ) : (
                  <span className="plant-locked-cost">{fmtNum(def.unlockCost)}</span>
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

export function CourierCard({ courier, cannabis, joints, managerCount, isLoggedIn, totalDeposited, onUpgradeCap, onUpgradeSpeed, onBuyManager, onSend }: {
  courier: CourierState
  cannabis: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  totalDeposited: number
  onUpgradeCap: () => void
  onUpgradeSpeed: () => void
  onBuyManager: () => void
  onSend: () => void
}) {
  const tripTime = courierTripTime(courier)
  const isMoving = courier.state !== 'idle'
  const progress = isMoving ? 1 - (courier.tripTimer / tripTime) : 0
  const speedUpg = getSpeedUpgrade(courier.speedLevel)
  const isAuto = courier.mgrLevel > 0
  const stateLabel = courier.state === 'toFactory' ? 'To Factory' : courier.state === 'toPlant' ? 'Returning' : 'Idle'
  const canSend = courier.state === 'idle' && cannabis > 0

  return (
    <div className="station-card station-courier">
      <div className="station-header">
        <Footprints size={20} className="station-header-icon" />
        <span className="station-name">Courier</span>
        <span className="station-level">{stateLabel}</span>
      </div>

      <div className="station-card-top">
        <CycleRing
          progress={progress}
          speed={courier.speed}
          color="rgba(255, 105, 180, .9)"
          trackColor="rgba(255, 105, 180, .15)"
          value={isMoving ? fmtNum(courier.carrying) : fmtNum(courier.capacity)}
          label={isAuto ? undefined : (isMoving ? 'En route...' : 'Send')}
          onClick={isAuto ? undefined : onSend}
          disabled={isAuto ? undefined : !canSend}
          ready={!isAuto && canSend}
        />
        <div className="station-info">
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Capacity</span>
              <span className="station-stat-value">{fmtNum(courier.capacity)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Carrying</span>
              <span className="station-stat-value">{fmtNum(courier.carrying)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Trip</span>
              <span className="station-stat-value">{tripTime.toFixed(1)}s</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Waiting</span>
              <span className="station-stat-value">{fmtNum(cannabis)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="station-actions">
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < courier.capCost}>
          Cap x2 — {fmtNum(courier.capCost)} Joints
        </button>
        {!isAuto && managerCount < 2 && (
          <button className="station-btn station-btn-manager station-btn-free" onClick={onBuyManager}>
            Hire Manager — Free!
          </button>
        )}
        {!isAuto && managerCount >= 2 && (!isLoggedIn || totalDeposited < 50) && (
          <button className="station-btn station-btn-manager" disabled>
            {!isLoggedIn ? 'Login + Deposit 50 sats to unlock' : `Deposit ${50 - totalDeposited} more sats to unlock`}
          </button>
        )}
        {!isAuto && managerCount >= 2 && isLoggedIn && totalDeposited >= 50 && (
          <button className="station-btn station-btn-manager" onClick={onBuyManager}>
            Hire Manager — {courier.mgrCost} sats
          </button>
        )}
        {speedUpg && (
          <button className="station-btn station-btn-speed" onClick={onUpgradeSpeed}>
            Speed {speedUpg.label} — {speedUpg.cost} sats
          </button>
        )}
      </div>
    </div>
  )
}

// ── Factory Station Card ────────────────────────────────────────────────────

export function FactoryCard({ fabrik, cannabisAtFactory, joints, managerCount, isLoggedIn, totalDeposited, onUpgradeCap, onUpgradeSpeed, onBuyManager, onRoll }: {
  fabrik: FabrikState
  cannabisAtFactory: number
  joints: number
  managerCount: number
  isLoggedIn: boolean
  totalDeposited: number
  onUpgradeCap: () => void
  onUpgradeSpeed: () => void
  onBuyManager: () => void
  onRoll: () => void
}) {
  const cycleTime = fabrikCycleTime(fabrik)
  const progress = fabrik.processing ? 1 - (fabrik.timer / fabrik.processTime) : 0
  const speedUpg = getSpeedUpgrade(fabrik.speedLevel)
  const isAuto = fabrik.mgrLevel > 0
  const canRoll = !fabrik.processing && cannabisAtFactory > 0

  return (
    <div className="station-card station-factory">
      <div className="station-header">
        <Factory size={20} className="station-header-icon" />
        <span className="station-name">Factory</span>
        <span className="station-level">{fabrik.processing ? 'Rolling...' : 'Idle'}</span>
      </div>

      <div className="station-card-top">
        <CycleRing
          progress={progress}
          speed={fabrik.speed}
          color="rgba(204, 68, 255, .9)"
          trackColor="rgba(204, 68, 255, .15)"
          value={fabrik.processing ? fmtNum(fabrik._currentCharge) : fmtNum(fabrik.capacity)}
          label={isAuto ? undefined : (fabrik.processing ? 'Rolling...' : 'Roll')}
          onClick={isAuto ? undefined : onRoll}
          disabled={isAuto ? undefined : !canRoll}
          ready={!isAuto && canRoll}
        />
        <div className="station-info">
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Capacity</span>
              <span className="station-stat-value">{fmtNum(fabrik.capacity)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Processing</span>
              <span className="station-stat-value">{fmtNum(fabrik._currentCharge)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Cycle</span>
              <span className="station-stat-value">{cycleTime.toFixed(1)}s</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Waiting</span>
              <span className="station-stat-value">{fmtNum(cannabisAtFactory)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Total</span>
              <span className="station-stat-value">{fmtNum(fabrik.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="station-actions">
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < fabrik.capCost}>
          Cap x2 — {fmtNum(fabrik.capCost)} Joints
        </button>
        {!isAuto && managerCount < 2 && (
          <button className="station-btn station-btn-manager station-btn-free" onClick={onBuyManager}>
            Hire Manager — Free!
          </button>
        )}
        {!isAuto && managerCount >= 2 && (!isLoggedIn || totalDeposited < 50) && (
          <button className="station-btn station-btn-manager" disabled>
            {!isLoggedIn ? 'Login + Deposit 50 sats to unlock' : `Deposit ${50 - totalDeposited} more sats to unlock`}
          </button>
        )}
        {!isAuto && managerCount >= 2 && isLoggedIn && totalDeposited >= 50 && (
          <button className="station-btn station-btn-manager" onClick={onBuyManager}>
            Hire Manager — {fabrik.mgrCost} sats
          </button>
        )}
        {speedUpg && (
          <button className="station-btn station-btn-speed" onClick={onUpgradeSpeed}>
            Speed {speedUpg.label} — {speedUpg.cost} sats
          </button>
        )}
      </div>
    </div>
  )
}
