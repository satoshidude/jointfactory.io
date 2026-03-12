// Proof of Work — compute SHA-256 hash with N leading hex zeros

export async function solvePow(challenge: string, difficulty: number): Promise<string> {
  let nonce = 0
  const prefix = '0'.repeat(difficulty)

  while (true) {
    const data = challenge + ':' + nonce
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    if (hex.startsWith(prefix)) return String(nonce)
    nonce++
    // Yield to UI every 5000 iterations
    if (nonce % 5000 === 0) await new Promise(r => setTimeout(r, 0))
  }
}

export async function fetchChallenge(): Promise<{ challenge: string; difficulty: number }> {
  const res = await fetch('/api/auth/challenge')
  if (!res.ok) throw new Error('Failed to get challenge')
  return res.json()
}
