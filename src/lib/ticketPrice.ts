import { ticketPrice, throughput } from '../../shared/economy.js'

/**
 * What the next ticket costs *right now*.
 *
 * The price is a share of a day of the buyer's own production, so it moves every
 * time they upgrade. The card used to print the figure the server sent when the
 * page was opened and only refreshed it on a draw — an active player outgrew it
 * within minutes. One pressed a button reading 9.8 M, the server priced the
 * click at 39.0 M against the chain as it stood, and the purchase was refused:
 * no ticket, no deduction, and a button that had promised otherwise.
 *
 * Computed from the same function the server prices with, off the running
 * chain's own rate, so the two cannot drift apart between two fetches. Boosts
 * are excluded on both sides — a boost must not make your ticket dearer. The
 * server still owns the actual charge; this only stops the button from lying.
 *
 * Falls back to the server's figure when there is no live chain to read, which
 * is the case on a direct visit to the lottery page.
 */
export function liveTicketPrice(rawGameState: any, held: number, serverCost: number): number {
  if (!rawGameState?.plantagen) return serverCost
  const rate = throughput(rawGameState, { speedLevel: rawGameState.speedLevel ?? 0 }).jointsPerSec
  if (!(rate > 0)) return serverCost
  return ticketPrice(held, rate)
}
