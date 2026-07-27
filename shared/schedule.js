/**
 * Lottery draw schedule — pure date math, no database.
 *
 * Tue, Thu, Sat at 21:00 Europe/Berlin. Three draws a week instead of six a day:
 * the pot is fed by sats spend, and spreading it over 42 draws/week left an
 * average pot of 6 sats. Fewer draws concentrate the same sats into a prize
 * that is worth playing for.
 */

export const DRAW_WEEKDAYS_BERLIN = [2, 4, 6] // Date.getDay(): Sun=0 … Sat=6
export const DRAW_HOUR_BERLIN = 21
export const DRAW_LABEL = 'Di, Do, Sa · 21:00'

const _berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
})

export function berlinFields(utcMs) {
  const parts = {}
  for (const p of _berlinParts.formatToParts(new Date(utcMs))) parts[p.type] = p.value
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +parts.hour, minute: +parts.minute, second: +parts.second,
  }
}

/** How far Berlin wall-clock runs ahead of UTC at the given instant, in ms. */
function berlinOffsetMs(utcMs) {
  const f = berlinFields(utcMs)
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - utcMs
}

/** UTC ms for a Berlin wall-clock time, resolved across DST transitions. */
export function berlinWallClockToUtc(year, month, day, hour) {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0)
  let utc = naive - berlinOffsetMs(naive)
  // One correction pass: the offset at the naive instant can differ from the
  // offset at the target when the two sit on opposite sides of a DST switch.
  utc = naive - berlinOffsetMs(utc)
  return utc
}

/** Unix seconds of the next draw strictly after `nowMs`. */
export function nextDrawTime(nowMs = Date.now()) {
  const now = berlinFields(nowMs)

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    // Date math in UTC so month and year boundaries are handled for us.
    const probe = new Date(Date.UTC(now.year, now.month - 1, now.day + dayOffset))
    if (!DRAW_WEEKDAYS_BERLIN.includes(probe.getUTCDay())) continue

    const utcMs = berlinWallClockToUtc(
      probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate(), DRAW_HOUR_BERLIN
    )
    if (utcMs <= nowMs) continue // today's draw already happened

    return Math.floor(utcMs / 1000)
  }

  // Unreachable: a scheduled weekday always occurs within 7 days.
  return Math.floor(nowMs / 1000) + 86400
}
