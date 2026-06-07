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
