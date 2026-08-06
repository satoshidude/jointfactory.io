import { useEffect, useMemo } from 'react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { useGameLoop } from '../../game/useGameLoop'
import { nextObjective } from '../../game/objectives'
import {
  ticketGate, ticketGateReason, ticketPrice, throughput,
  speedMultiplier, speedCost, ROUND_TARGET,
} from '../../../shared/economy.js'
import { PlantationsCard, CourierCard, FactoryCard } from '../../components/mobile/StationCard'
import LotteryMini from '../../components/mobile/LotteryMini'
import RoundCard from '../../components/mobile/RoundCard'
import BoostBar from '../../components/mobile/BoostBar'
import SpeedCard from '../../components/mobile/SpeedCard'
import ZapclubBanner from '../../components/mobile/ZapclubBanner'
import GrowthRace from '../../components/mobile/GrowthRace'
import './MobilePages.css'

export default function MobileGame() {
  const auth = useAuth()
  const gd = useGameDisplay()

  const { state, actions, boostGrants } = useGameLoop(
    auth.isLoggedIn ? auth.joints : 0,
    auth.isLoggedIn ? auth.sats : 0,
    auth.isLoggedIn ? auth.jointsRev : 0,
    auth.isLoggedIn ? auth.setJoints : undefined,
    auth.isLoggedIn ? auth.setSats : undefined,
    auth.isNewAccount,
  )

  // Ticket eligibility: the chain automated, and one manager paid for in sats.
  // Same function the server checks against, so the two cannot drift apart.
  const gate = useMemo(
    () => ticketGate(state, state.roundsCompleted, state.satsIntoPot),
    [state.plantagen, state.courier?.mgrLevel, state.fabrik?.mgrLevel, state.roundsCompleted, state.satsIntoPot] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const eligible = gate.eligible
  const managersNeeded = gate.missing
  const ticketHint = ticketGateReason(gate)

  // Sync display state for header stats + lottery eligibility
  useEffect(() => {
    gd.update({
      cannabis: state.cannabis,
      cannabisAtFactory: state.cannabisAtFactory,
      courierCarrying: state.courier.carrying,
      joints: state.joints,
      sats: state.sats,
      rawGameState: state,
      eligible,
      upgradesNeeded: managersNeeded,
      ticketHint,
    })
  }, [state.joints, state.sats, state.cannabis, state.cannabisAtFactory, state.courier.carrying, state.managerCount, eligible, ticketHint]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ticket prices scale with production, so the floor price is no longer a
  // useful yardstick — an endgame player pays ~5 minutes of output for their
  // first ticket. Priced the same way the server does; LotteryMini still owns
  // the exact next price and gates the buy button on it.
  // Both prices are a share of the player's own output. Quoted here with the
  // same functions the server uses; the server still owns every purchase.
  const rate = throughput(state, { speedLevel: state.speedLevel }).jointsPerSec
  const firstTicketCost = ticketPrice(0, rate)
  const nextSpeedCost = speedCost(state.speedLevel, rate)
  const objective = nextObjective(state, auth.isLoggedIn, state.joints >= firstTicketCost)
  // Past the target the loop stops advancing the chain; the cards say so.
  const roundOver = state.totalJointsEarned >= ROUND_TARGET


  // Sync total earned
  useEffect(() => {
    if (auth.isLoggedIn && state.totalJointsEarned > 0) {
      auth.setTotalJointsEarned(state.totalJointsEarned)
    }
  }, [state.totalJointsEarned]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mobile-page mobile-game-page">
      {objective && (
        <div className="mgp-objective" role="status">{objective}</div>
      )}

      <div className="mgp-col mgp-col-left">
        <LotteryMini />

        <FactoryCard
          fabrik={state.fabrik}
          courier={state.courier}
          plantagen={state.plantagen}
          cannabisAtFactory={state.cannabisAtFactory}
          joints={state.joints}
          mgrCost={state.managerCosts.fabrik ?? 0}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          frozen={roundOver}
          onUpgradeCap={actions.upgradeFabrikCap}
          onBuyManager={actions.buyFabrikManager}
          onRoll={actions.rollJoints}
        />

        <CourierCard
          courier={state.courier}
          cannabis={state.cannabis}
          joints={state.joints}
          mgrCost={state.managerCosts.courier ?? 0}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          frozen={roundOver}
          onUpgradeCap={actions.upgradeCourierCap}
          onBuyManager={actions.buyCourierManager}
          onSend={actions.sendCourier}
        />

        <BoostBar
          boosts={state.boosts}
          grants={boostGrants}
          sats={state.sats}
          isLoggedIn={auth.isLoggedIn}
          onBuy={actions.buyBoost}
          onClaim={actions.claimBoost}
        />

        <SpeedCard
          level={state.speedLevel}
          multiplier={speedMultiplier(state.speedLevel)}
          nextMultiplier={speedMultiplier(state.speedLevel + 1)}
          nextCost={nextSpeedCost}
          joints={state.joints}
          isLoggedIn={auth.isLoggedIn}
          onBuy={actions.buySpeed}
        />

      </div>

      <div className="mgp-col mgp-col-right">
        <PlantationsCard
          plantagen={state.plantagen}
          cannabis={state.cannabis}
          joints={state.joints}
          managerCosts={state.managerCosts}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          frozen={roundOver}
          onUpgradeLevel={(i) => actions.upgradePlantLevel(i)}
          onBuyManager={(i) => actions.buyPlantManager(i)}
          onGrow={(i) => actions.grow(i)}
          onUnlock={actions.unlockPlantation}
        />

        {/* The standings, where the chain they are about is. The round rides on
            top of them: both are the same run towards the same quadrillion, and
            two frames for that cost the Grow page a screenful. */}
        <GrowthRace header={
          <RoundCard
            embedded
            totalEarned={state.totalJointsEarned}
            isLoggedIn={auth.isLoggedIn}
            // The loop holds the chain in refs across the whole session; reloading
            // is the one way to be certain the fresh round is what it picks up.
            onReset={() => window.location.reload()}
          />
        } />

        <ZapclubBanner />
      </div>
    </div>
  )
}
