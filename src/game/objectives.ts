import { FREE_MANAGERS, REQUIRED_MANAGERS, countManagers, countLotteryManagers } from '../../shared/economy.js'
import type { DisplayState } from './useGameLoop'

/**
 * The next useful step, as one line of text.
 *
 * The production chain has three stages that each stall for a different reason,
 * and nothing in the UI said which one was waiting on the player — a newcomer
 * saw a screen of numbers and no direction. This reads the state that already
 * exists rather than tracking tutorial progress, so it needs no persistence and
 * cannot get stuck out of sync.
 *
 * Returns null once the player is running and has bought in — no nagging.
 */
export function nextObjective(state: DisplayState, isLoggedIn: boolean, canAffordTicket: boolean): string | null {
  const managers = countManagers(state)
  const chainManagers = countLotteryManagers(state)

  const plant = state.plantagen?.[0]
  const plantReady = plant && plant.managerLevel === 0 && plant.timer >= plant.cycleTime
  const courierIdle = state.courier?.mgrLevel === 0 && state.courier?.state === 'idle'
  const factoryIdle = state.fabrik?.mgrLevel === 0 && !state.fabrik?.processing

  // Stage 1: nothing harvested yet.
  if (state.cannabis <= 0 && state.cannabisAtFactory <= 0 && plantReady) {
    return 'Tippe auf Grow — deine erste Ernte wartet'
  }
  // Stage 2: weed sitting in the field with an idle courier.
  if (state.cannabis > 0 && courierIdle) {
    return 'Schick den Kurier los — er bringt das Weed zur Fabrik'
  }
  // Stage 3: weed delivered, factory idle.
  if (state.cannabisAtFactory > 0 && factoryIdle) {
    return 'Roll die Joints — die Fabrik hat Nachschub'
  }
  // Automate what is still manual, while it is free.
  if (managers < FREE_MANAGERS) {
    const left = FREE_MANAGERS - managers
    return `Stell ${left === 1 ? 'noch einen Manager' : `noch ${left} Manager`} ein — gratis, dann läuft die Station allein`
  }
  // Free managers spent, but not on the three stations the chain needs.
  if (chainManagers < REQUIRED_MANAGERS) {
    const missing = [
      state.plantagen?.[0]?.managerLevel === 0 ? 'die Plantage' : null,
      state.courier?.mgrLevel === 0 ? 'den Kurier' : null,
      state.fabrik?.mgrLevel === 0 ? 'die Fabrik' : null,
    ].filter(Boolean)
    return `Für die Lotterie fehlt ein Manager auf ${missing.join(' und ')}`
  }
  // Chain runs — the reward loop needs an identity the server can pay out to.
  if (!isLoggedIn) {
    return 'Melde dich an und spiel mit deinen Joints um echte Sats'
  }
  if (canAffordTicket) {
    return 'Du hast genug Joints für ein Los'
  }
  return null
}
