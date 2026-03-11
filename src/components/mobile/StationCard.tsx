import { useRef } from 'react'
import type { PlantationState, CourierState, FabrikState } from '../../game/useGameLoop'
import {
  plantLevelCost, plantMilestoneInfo, plantOutput, plantEffectiveCycle, plantRate,
  courierTripTime, fabrikCycleTime,
  getSpeedUpgrade,
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

function CycleRing({ progress, speed, color, trackColor, size = 100, stroke = 5 }: {
  progress: number; speed: number; color: string; trackColor: string; size?: number; stroke?: number
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circ * (1 - clamped)
  const prevRef = useRef(clamped)
  const flashRef = useRef(0)

  // Detect cycle completion (progress wraps from high to low)
  if (prevRef.current > 0.7 && clamped < 0.3) {
    flashRef.current++
  }
  prevRef.current = clamped

  // Glow intensity scales with speed
  const glowIntensity = Math.min(1, speed / 4)

  return (
    <svg width={size} height={size} className="cycle-ring" style={{
      filter: `drop-shadow(0 0 ${4 + glowIntensity * 8}px ${color})`
    }}>
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={trackColor} strokeWidth={stroke} />
      {/* Progress arc */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke + glowIntensity * 2}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.05s linear' }} />
      {/* Flash ring on cycle complete */}
      <circle key={flashRef.current} cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="cycle-ring-flash" />
    </svg>
  )
}

// ── Plantation Station Card ─────────────────────────────────────────────────

export function PlantCard({ plant, joints, onUpgradeLevel, onUpgradeSpeed, onBuyManager, onGrow }: {
  plant: PlantationState
  joints: number
  onUpgradeLevel: () => void
  onUpgradeSpeed: () => void
  onBuyManager: () => void
  onGrow: () => void
}) {
  const cycle = plantEffectiveCycle(plant)
  const progress = 1 - (plant.timer / plant.cycleTime)
  const output = plantOutput(plant)
  const rate = plantRate(plant)
  const levelCost = plantLevelCost(plant)
  const milestone = plantMilestoneInfo(plant.level)
  const speedUpg = getSpeedUpgrade(plant.speedLevel)
  const canAffordLevel = joints >= levelCost
  const needForLevel = levelCost - Math.floor(joints)
  const isAuto = plant.managerLevel > 0

  return (
    <div className="station-card station-plant">
      <div className="station-card-top">
        <div className="station-ring-wrap">
          <CycleRing
            progress={progress}
            speed={plant.speed}
            color="rgba(57, 255, 20, .9)"
            trackColor="rgba(57, 255, 20, .15)"
          />
          <div className="station-ring-center">
            <span className="station-ring-icon">{plant.icon}</span>
            <span className="station-ring-speed">{plant.speed.toFixed(1)}x</span>
          </div>
        </div>
        <div className="station-info">
          <div className="station-name">{plant.name}</div>
          <div className="station-level">Lvl {plant.level}</div>
          <div className="station-stats">
            <div className="station-stat-row">
              <span className="station-stat-label">Output</span>
              <span className="station-stat-value">{fmtNum(output)}</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Rate</span>
              <span className="station-stat-value">{fmtNum(rate)}/s</span>
            </div>
            <div className="station-stat-row">
              <span className="station-stat-label">Cycle</span>
              <span className="station-stat-value">{cycle.toFixed(1)}s</span>
            </div>
            {milestone.levelsToNext <= 5 && (
              <div className="station-stat-row station-milestone">
                <span className="station-stat-label">Milestone</span>
                <span className="station-stat-value">{milestone.levelsToNext} lvl → {milestone.nextMult}x</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="station-actions">
        {!isAuto && (
          <button className="station-btn station-btn-grow" onClick={onGrow}>
            Grow
          </button>
        )}
        <button
          className={`station-btn station-btn-level${canAffordLevel ? '' : ' insufficient'}`}
          onClick={onUpgradeLevel}
          disabled={!canAffordLevel}
        >
          {canAffordLevel
            ? `Upgrade — ${fmtNum(levelCost)}`
            : `Need ${fmtNum(needForLevel)} more`
          }
        </button>
        {!isAuto && (
          <button className="station-btn station-btn-manager" onClick={onBuyManager}>
            Hire Manager — {plant.mgrCost} sats
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

// ── Courier Station Card ────────────────────────────────────────────────────

export function CourierCard({ courier, cannabis, joints, onUpgradeCap, onUpgradeSpeed, onBuyManager, onSend }: {
  courier: CourierState
  cannabis: number
  joints: number
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

  return (
    <div className="station-card station-courier">
      <div className="station-card-top">
        <div className="station-ring-wrap">
          <CycleRing
            progress={progress}
            speed={courier.speed}
            color="rgba(255, 105, 180, .9)"
            trackColor="rgba(255, 105, 180, .15)"
          />
          <div className="station-ring-center">
            <span className="station-ring-icon">🚐</span>
            <span className="station-ring-speed">{courier.speed.toFixed(1)}x</span>
          </div>
        </div>
        <div className="station-info">
          <div className="station-name">Courier</div>
          <div className="station-level">{stateLabel}</div>
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
        {!isAuto && (
          <button className="station-btn station-btn-grow" onClick={onSend}
            disabled={courier.state !== 'idle' || cannabis <= 0}>
            Send Courier
          </button>
        )}
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < courier.capCost}>
          Cap x2 — {fmtNum(courier.capCost)} Joints
        </button>
        {!isAuto && (
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

export function FactoryCard({ fabrik, cannabisAtFactory, joints, onUpgradeCap, onUpgradeSpeed, onBuyManager, onRoll }: {
  fabrik: FabrikState
  cannabisAtFactory: number
  joints: number
  onUpgradeCap: () => void
  onUpgradeSpeed: () => void
  onBuyManager: () => void
  onRoll: () => void
}) {
  const cycleTime = fabrikCycleTime(fabrik)
  const progress = fabrik.processing ? 1 - (fabrik.timer / fabrik.processTime) : 0
  const speedUpg = getSpeedUpgrade(fabrik.speedLevel)
  const isAuto = fabrik.mgrLevel > 0

  return (
    <div className="station-card station-factory">
      <div className="station-card-top">
        <div className="station-ring-wrap">
          <CycleRing
            progress={progress}
            speed={fabrik.speed}
            color="rgba(204, 68, 255, .9)"
            trackColor="rgba(204, 68, 255, .15)"
          />
          <div className="station-ring-center">
            <span className="station-ring-icon">🏭</span>
            <span className="station-ring-speed">{fabrik.speed.toFixed(1)}x</span>
          </div>
        </div>
        <div className="station-info">
          <div className="station-name">Factory</div>
          <div className="station-level">{fabrik.processing ? 'Rolling...' : 'Idle'}</div>
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
        {!isAuto && (
          <button className="station-btn station-btn-grow" onClick={onRoll}
            disabled={fabrik.processing || cannabisAtFactory <= 0}>
            Roll Joints
          </button>
        )}
        <button className="station-btn station-btn-level" onClick={onUpgradeCap}
          disabled={joints < fabrik.capCost}>
          Cap x2 — {fmtNum(fabrik.capCost)} Joints
        </button>
        {!isAuto && (
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
