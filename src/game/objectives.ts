import { FREE_MANAGERS, REQUIRED_MANAGERS, countManagers, countLotteryManagers,
         ticketGate, managerPrice } from '../../shared/economy.js'
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
    return 'Tap Grow — your first harvest is ready'
  }
  // Stage 2: weed sitting in the field with an idle courier.
  if (state.cannabis > 0 && courierIdle) {
    return 'Send the courier — he hauls the weed to the factory'
  }
  // Stage 3: weed delivered, factory idle.
  if (state.cannabisAtFactory > 0 && factoryIdle) {
    return 'Roll the joints — the factory has supply waiting'
  }
  // Automate what is still manual, while it is free.
  if (managers < FREE_MANAGERS) {
    const left = FREE_MANAGERS - managers
    return `Hire ${left === 1 ? 'one more manager' : `${left} more managers`} — free, and the station runs itself`
  }
  // Free managers spent, but not on the three stations the chain needs.
  if (chainManagers < REQUIRED_MANAGERS) {
    const missing = [
      state.plantagen?.[0]?.managerLevel === 0 ? 'the plantation' : null,
      state.courier?.mgrLevel === 0 ? 'the courier' : null,
      state.fabrik?.mgrLevel === 0 ? 'the factory' : null,
    ].filter(Boolean)
    return `The lottery needs a manager on ${missing.join(' and ')}`
  }
  // Chain runs — the reward loop needs an identity the server can pay out to.
  if (!isLoggedIn) {
    return 'Log in to play your joints for real sats'
  }
  // The pot is fed by sats, so a ticket asks for some of them — a boost or a
  // manager, either one. Asked through the gate itself rather than by counting
  // managers, so a player who has already bought a boost is not told to go buy
  // something they have bought. The free three managers are exactly the chain,
  // which is why this comes after it and not with it.
  if (ticketGate(state, state.roundsCompleted, state.satsIntoPot).missingPaid > 0) {
    return `Spend sats this round — a boost from 10, or a manager for ${managerPrice(state.roundsCompleted)} — and the lottery opens`
  }
  if (canAffordTicket) {
    return 'You have enough joints for a ticket'
  }
  return null
}
