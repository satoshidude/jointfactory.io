const RELAYS = [
  'wss://relay.nsnip.io/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.snort.social/',
  'wss://relay.nostr.band/',
]

export interface NostrProfile {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  nip05?: string
  lud16?: string
  website?: string
}

export async function fetchNostrProfile(pubkeyHex: string): Promise<NostrProfile> {
  return new Promise((resolve) => {
    let best: { created_at: number; profile: NostrProfile } | null = null
    let responded = 0
    const total = RELAYS.length
    const timeout = setTimeout(() => resolve(best?.profile || {}), 8000)

    for (const url of RELAYS) {
      try {
        const ws = new WebSocket(url)
        const wsTimeout = setTimeout(() => { ws.close() }, 6000)
        ws.onopen = () => {
          ws.send(JSON.stringify(['REQ', 'profile', { kinds: [0], authors: [pubkeyHex], limit: 1 }]))
        }
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data)
            if (Array.isArray(data) && data[0] === 'EVENT' && data[2]) {
              const ev = data[2]
              const profile = JSON.parse(ev.content) as NostrProfile
              if (!best || ev.created_at > best.created_at) {
                best = { created_at: ev.created_at, profile }
              }
            }
            if (Array.isArray(data) && data[0] === 'EOSE') {
              clearTimeout(wsTimeout)
              ws.close()
              responded++
              if (responded >= total) { clearTimeout(timeout); resolve(best?.profile || {}) }
            }
          } catch {}
        }
        ws.onerror = () => { clearTimeout(wsTimeout); responded++; if (responded >= total) { clearTimeout(timeout); resolve(best?.profile || {}) } }
      } catch { responded++; if (responded >= total) { clearTimeout(timeout); resolve(best?.profile || {}) } }
    }
  })
}
