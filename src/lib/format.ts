// Compact number formatting with short-scale suffixes.
// Single source of truth — replaces the ~11 divergent copies that used to
// live in individual components (which is how the "missing T suffix" bug crept in).
//
// Covers K (1e3) up to Dc (1e33), i.e. far beyond any realistic in-game value
// (current max lifetime is ~8 Qa / 1e15). Values >= 1e36 keep rendering as
// "…Dc" rather than breaking — acceptable, the game cannot reach that range.
const TIERS: ReadonlyArray<readonly [number, string]> = [
  [1e33, 'Dc'], // Decillion
  [1e30, 'No'], // Nonillion
  [1e27, 'Oc'], // Octillion
  [1e24, 'Sp'], // Septillion
  [1e21, 'Sx'], // Sextillion
  [1e18, 'Qi'], // Quintillion
  [1e15, 'Q'],  // Quadrillion
  [1e12, 'T'],  // Trillion
  [1e9, 'B'],   // Billion
  [1e6, 'M'],   // Million
  [1e3, 'K'],   // Thousand
]

const THIN_SPACE = ' '

/**
 * Format a number with a short-scale suffix (e.g. 7_888_090_208_466_959 -> "7.9 Qa").
 * @param n        value to format
 * @param decimals fractional digits for the abbreviated part (default 1)
 * @param sep      separator between number and suffix (default thin space)
 */
export function fmtNum(n: number, decimals = 1, sep: string = THIN_SPACE): string {
  if (!Number.isFinite(n)) return '0'
  const neg = n < 0
  const abs = Math.abs(n)
  for (const [threshold, suffix] of TIERS) {
    if (abs >= threshold) {
      return (neg ? '-' : '') + (abs / threshold).toFixed(decimals) + sep + suffix
    }
  }
  return (neg ? '-' : '') + Math.floor(abs).toLocaleString()
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Countdown to the next draw. Draws run Tue/Thu/Sat, so the gap reaches three
 * days — the old HH:MM:SS-only copies in four components rendered that as
 * "71:14:03". Days are split out above 24h.
 */
export function fmtCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00:00'
  const total = Math.floor(seconds)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const clock = `${pad(h)}:${pad(m)}:${pad(s)}`
  return d > 0 ? `${d}d ${clock}` : clock
}

/**
 * Absolute draw time. A bare "21:00" was unambiguous at six draws a day but is
 * not when the next one may be three days out, so the weekday comes along.
 */
export function fmtDrawTime(unixSeconds: number): string {
  if (!unixSeconds) return '--:--'
  return new Date(unixSeconds * 1000).toLocaleString([], {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
}
