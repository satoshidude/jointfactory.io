import { useEffect } from 'react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { useGameLoop } from '../../game/useGameLoop'
import LotteryWidget from '../../components/mobile/LotteryWidget'
import { PlantationsCard, CourierCard, FactoryCard } from '../../components/mobile/StationCard'
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

  // Sync display state for header stats
  useEffect(() => {
    gd.update({
      cannabis: state.cannabis,
      cannabisAtFactory: state.cannabisAtFactory,
      courierCarrying: state.courier.carrying,
      joints: state.joints,
      sats: state.sats,
      rawGameState: state,
    })
  }, [state.joints, state.sats, state.cannabis, state.cannabisAtFactory, state.courier.carrying, state.managerCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync total earned
  useEffect(() => {
    if (auth.isLoggedIn && state.totalJointsEarned > 0) {
      auth.setTotalJointsEarned(state.totalJointsEarned)
    }
  }, [state.totalJointsEarned]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mobile-page mobile-game-page">
      <LotteryWidget />

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
    </div>
  )
}
