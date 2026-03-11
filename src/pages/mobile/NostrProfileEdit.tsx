import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Loader, Globe, Key } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { hasExtension } from '../../lib/nostr'
import { fetchNostrProfile, type NostrProfile } from '../../lib/nostrProfile'
import './MobilePages.css'

const RELAYS = [
  'wss://relay.nsnip.io/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.snort.social/',
  'wss://relay.nostr.band/',
]

async function publishToRelays(signedEvent: unknown): Promise<{ ok: number; fail: number }> {
  const results = await Promise.allSettled(
    RELAYS.map(url => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 10000)
      ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]))
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data)
          if (Array.isArray(data) && data[0] === 'OK') {
            clearTimeout(timeout)
            data[2] ? resolve() : reject(new Error(data[3] || 'rejected'))
            ws.close()
          }
        } catch {}
      }
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('ws error')) }
    }))
  )
  return {
    ok: results.filter(r => r.status === 'fulfilled').length,
    fail: results.filter(r => r.status === 'rejected').length,
  }
}

export default function NostrProfileEdit() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [nsecInput, setNsecInput] = useState('')
  const [showNsec, setShowNsec] = useState(false)

  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [banner, setBanner] = useState('')
  const [nip05, setNip05] = useState('')
  const [lud16, setLud16] = useState('')
  const [website, setWebsite] = useState('')

  const [originalProfile, setOriginalProfile] = useState<NostrProfile>({})

  useEffect(() => {
    if (!auth.npub) { navigate('/profile'); return }
    fetchNostrProfile(auth.npub).then(p => {
      setOriginalProfile(p)
      setName(p.name || '')
      setDisplayName(p.display_name || '')
      setAbout(p.about || '')
      setPicture(p.picture || '')
      setBanner(p.banner || '')
      setNip05(p.nip05 || '')
      setLud16(p.lud16 || '')
      setWebsite(p.website || '')
      setLoading(false)
    })
  }, [auth.npub, navigate])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    const profile: Record<string, unknown> = { ...originalProfile }
    if (name.trim()) profile.name = name.trim(); else delete profile.name
    if (displayName.trim()) profile.display_name = displayName.trim(); else delete profile.display_name
    if (about.trim()) profile.about = about.trim(); else delete profile.about
    if (picture.trim()) profile.picture = picture.trim(); else delete profile.picture
    if (banner.trim()) profile.banner = banner.trim(); else delete profile.banner
    if (nip05.trim()) profile.nip05 = nip05.trim(); else delete profile.nip05
    if (lud16.trim()) profile.lud16 = lud16.trim(); else delete profile.lud16
    if (website.trim()) profile.website = website.trim(); else delete profile.website

    const unsigned = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: JSON.stringify(profile),
    }

    try {
      let signedEvent: unknown

      if (hasExtension() && !showNsec) {
        signedEvent = await window.nostr!.signEvent(unsigned)
      } else {
        if (!nsecInput.trim()) { setError('Enter your nsec to sign'); setSaving(false); return }
        const { finalizeEvent } = await import('nostr-tools/pure')
        const { decode } = await import('nostr-tools/nip19')

        let secretKey: Uint8Array
        if (nsecInput.startsWith('nsec1')) {
          const decoded = decode(nsecInput)
          if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
          secretKey = decoded.data
        } else {
          const bytes = new Uint8Array(nsecInput.length / 2)
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(nsecInput.slice(i * 2, i * 2 + 2), 16)
          secretKey = bytes
        }

        signedEvent = finalizeEvent(unsigned, secretKey)
      }

      const { ok, fail } = await publishToRelays(signedEvent)
      if (ok > 0) {
        setSuccess(`Published to ${ok} relay${ok > 1 ? 's' : ''}${fail > 0 ? ` (${fail} failed)` : ''}`)
        setTimeout(() => navigate('/profile'), 2000)
      } else {
        setError('Failed to publish to any relay')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Signing failed')
    } finally {
      setSaving(false)
    }
  }

  const hasExt = hasExtension()

  if (loading) {
    return (
      <div className="mobile-page mobile-profile">
        <div className="np-loading">
          <Loader size={24} className="spin" />
          <span>Loading profile from relays...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-page mobile-profile">
      <div className="mp-card">
        <h3 className="mp-card-title"><Globe size={16} /> Nostr Profile</h3>

        <div className="np-field">
          <label className="np-label">Name</label>
          <input className="mp-input" value={name} onChange={e => setName(e.target.value)} placeholder="username" />
        </div>
        <div className="np-field">
          <label className="np-label">Display Name</label>
          <input className="mp-input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your Name" />
        </div>
        <div className="np-field">
          <label className="np-label">About</label>
          <textarea className="mp-input np-textarea" value={about} onChange={e => setAbout(e.target.value)} placeholder="Bio..." rows={3} />
        </div>
        <div className="np-field">
          <label className="np-label">Picture URL</label>
          <input className="mp-input" value={picture} onChange={e => setPicture(e.target.value)} placeholder="https://..." />
        </div>
        <div className="np-field">
          <label className="np-label">Banner URL</label>
          <input className="mp-input" value={banner} onChange={e => setBanner(e.target.value)} placeholder="https://..." />
        </div>
        <div className="np-field">
          <label className="np-label">NIP-05</label>
          <input className="mp-input" value={nip05} onChange={e => setNip05(e.target.value)} placeholder="user@domain.com" />
        </div>
        <div className="np-field">
          <label className="np-label">Lightning Address</label>
          <input className="mp-input" value={lud16} onChange={e => setLud16(e.target.value)} placeholder="user@wallet.com" />
        </div>
        <div className="np-field">
          <label className="np-label">Website</label>
          <input className="mp-input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
        </div>

        {/* Signing method */}
        <div className="np-sign-section">
          {hasExt && !showNsec ? (
            <div className="np-sign-info">
              <span>Signing with browser extension</span>
              <button className="np-sign-toggle" onClick={() => setShowNsec(true)}>
                <Key size={12} /> Use nsec instead
              </button>
            </div>
          ) : (
            <div className="np-field">
              <label className="np-label"><Key size={12} /> nsec (private key)</label>
              <input
                className="mp-input"
                type="password"
                value={nsecInput}
                onChange={e => setNsecInput(e.target.value)}
                placeholder="nsec1..."
              />
              {hasExt && (
                <button className="np-sign-toggle" onClick={() => setShowNsec(false)}>
                  Use extension instead
                </button>
              )}
            </div>
          )}
        </div>

        <button className="np-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader size={14} className="spin" /> Publishing...</> : <><Save size={14} /> Publish to Nostr</>}
        </button>

        {error && <p className="mp-error">{error}</p>}
        {success && <p className="np-success">{success}</p>}
      </div>
    </div>
  )
}
