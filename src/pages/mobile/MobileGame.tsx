import { useEffect, useMemo } from 'react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { useGameLoop } from '../../game/useGameLoop'
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

  // Manager eligibility (3 required for lottery/withdraw)
  const mgrCount = useMemo(() => {
    let c = 0
    if (state.plantagen?.[0]?.managerLevel > 0) c++
    if (state.courier?.mgrLevel > 0) c++
    if (state.fabrik?.mgrLevel > 0) c++
    return c
  }, [state.plantagen, state.courier?.mgrLevel, state.fabrik?.mgrLevel])
  const eligible = mgrCount >= 3
  const managersNeeded = 3 - mgrCount

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

  // Sync total earned
  useEffect(() => {
    if (auth.isLoggedIn && state.totalJointsEarned > 0) {
      auth.setTotalJointsEarned(state.totalJointsEarned)
    }
  }, [state.totalJointsEarned]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mobile-page mobile-game-page">
      <div className="mgp-col mgp-col-left">
        <LotteryMini />

        <FactoryCard
          fabrik={state.fabrik}
          cannabisAtFactory={state.cannabisAtFactory}
          joints={state.joints}
          managerCount={state.managerCount}
          isLoggedIn={auth.isLoggedIn}
          totalDeposited={auth.totalDeposited}
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
          totalDeposited={auth.totalDeposited}
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
          totalDeposited={auth.totalDeposited}
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
