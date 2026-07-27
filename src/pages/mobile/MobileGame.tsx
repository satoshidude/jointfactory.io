import { useEffect, useMemo } from 'react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { useGameLoop } from '../../game/useGameLoop'
import { nextObjective } from '../../game/objectives'
import { countLotteryManagers, REQUIRED_MANAGERS, TICKET_PRICE_CURVE } from '../../../shared/economy.js'
import { PlantationsCard, CourierCard, FactoryCard } from '../../components/mobile/StationCard'
import LotteryMini from '../../components/mobile/LotteryMini'
import GrowthRace from '../../components/mobile/GrowthRace'
import Leaderboard from '../../components/mobile/Leaderboard'
import './MobilePages.css'

export default function MobileGame() {
  const auth = useAuth()
  const gd = useGameDisplay()

  const { state, actions } = useGameLoop(
    auth.isLoggedIn ? auth.joints : 0,
    auth.isLoggedIn ? auth.sats : 0,
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

  // Cheapest a ticket can ever be — enough for a nudge; LotteryMini knows the
  // player's actual next price and gates the buy button on it.
  const objective = nextObjective(state, auth.isLoggedIn, state.joints >= TICKET_PRICE_CURVE[0])

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
          cannabisAtFactory={state.cannabisAtFactory}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          onUpgradeCap={actions.upgradeFabrikCap}
          onUpgradeSpeed={actions.upgradeFabrikSpeed}
          onBuyManager={actions.buyFabrikManager}
          onRoll={actions.rollJoints}
        />

        <CourierCard
          courier={state.courier}
          cannabis={state.cannabis}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          onUpgradeCap={actions.upgradeCourierCap}
          onUpgradeSpeed={actions.upgradeCourierSpeed}
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
          onUpgradeLevel={(i) => actions.upgradePlantLevel(i)}
          onUpgradeSpeed={(i) => actions.upgradePlantSpeed(i)}
          onBuyManager={(i) => actions.buyPlantManager(i)}
          onGrow={(i) => actions.grow(i)}
          onUnlock={actions.unlockPlantation}
        />

        <GrowthRace />
      </div>
    </div>
  )
}
