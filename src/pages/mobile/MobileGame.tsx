import { useEffect, useMemo } from 'react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { useGameLoop } from '../../game/useGameLoop'
import { nextObjective } from '../../game/objectives'
import {
  countLotteryManagers, REQUIRED_MANAGERS, ticketPrice, throughput,
  speedMultiplier, speedCost,
} from '../../../shared/economy.js'
import { PlantationsCard, CourierCard, FactoryCard } from '../../components/mobile/StationCard'
import LotteryMini from '../../components/mobile/LotteryMini'
import BoostBar from '../../components/mobile/BoostBar'
import SpeedCard from '../../components/mobile/SpeedCard'
import GrowthRace from '../../components/mobile/GrowthRace'
import Leaderboard from '../../components/mobile/Leaderboard'
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

  // Lottery/withdraw eligibility: plantation #1, courier and factory automated.
  // Same function the server checks against, so the two cannot drift apart.
  const mgrCount = useMemo(
    () => countLotteryManagers(state),
    [state.plantagen, state.courier?.mgrLevel, state.fabrik?.mgrLevel] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const eligible = mgrCount >= REQUIRED_MANAGERS
  const managersNeeded = REQUIRED_MANAGERS - mgrCount

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
    })
  }, [state.joints, state.sats, state.cannabis, state.cannabisAtFactory, state.courier.carrying, state.managerCount, eligible]) // eslint-disable-line react-hooks/exhaustive-deps

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

        <FactoryCard
          fabrik={state.fabrik}
          courier={state.courier}
          cannabisAtFactory={state.cannabisAtFactory}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          onUpgradeCap={actions.upgradeFabrikCap}
          onBuyManager={actions.buyFabrikManager}
          onRoll={actions.rollJoints}
        />

        <CourierCard
          courier={state.courier}
          cannabis={state.cannabis}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          onUpgradeCap={actions.upgradeCourierCap}
          onBuyManager={actions.buyCourierManager}
          onSend={actions.sendCourier}
        />

        <Leaderboard />
      </div>

      <div className="mgp-col mgp-col-right">
        <PlantationsCard
          plantagen={state.plantagen}
          cannabis={state.cannabis}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          boosts={state.boosts}
          speedLevel={state.speedLevel}
          onUpgradeLevel={(i) => actions.upgradePlantLevel(i)}
          onBuyManager={(i) => actions.buyPlantManager(i)}
          onGrow={(i) => actions.grow(i)}
          onUnlock={actions.unlockPlantation}
        />

        <GrowthRace />
      </div>
    </div>
  )
}
