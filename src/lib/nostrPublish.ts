export const PUBLISH_RELAYS = [
  'wss://relay.nsnip.io/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
]

export async function publishToRelays(signedEvent: unknown): Promise<{ ok: number; fail: number }> {
  const results = await Promise.allSettled(
    PUBLISH_RELAYS.map(url => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      const timeout = window.setTimeout(() => {
        ws.close()
        reject(new Error('timeout'))
      }, 10000)

      ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]))
      ws.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data)
          if (Array.isArray(data) && data[0] === 'OK') {
            window.clearTimeout(timeout)
            if (data[2]) resolve()
            else reject(new Error(data[3] || 'rejected'))
            ws.close()
          }
        } catch {
          // Ignore unrelated or malformed relay messages until timeout.
        }
      }
      ws.onerror = () => {
        window.clearTimeout(timeout)
        reject(new Error('websocket error'))
      }
    })),
  )

  return {
    ok: results.filter(result => result.status === 'fulfilled').length,
    fail: results.filter(result => result.status === 'rejected').length,
  }
}
