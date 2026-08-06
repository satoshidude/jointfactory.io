/**
 * Admin — owner only, and the only place in the app that can write to players
 * from outside the game.
 *
 * The flow is deliberately two-step. A dry run resolves every recipient, builds
 * and encrypts every message and stops at the relay, so the count and the list
 * can be checked against reality. Only then does the send button unlock, and it
 * asks for the campaign name to be typed back — a DM that reached a relay cannot
 * be recalled, and thirty-odd of them cannot be recalled thirty-odd times.
 *
 * The campaign name is also what makes a re-run safe: anyone already written to
 * under that name is skipped, so an interrupted send resumes instead of
 * repeating itself.
 */

import { useState, useEffect, useCallback } from 'react'
import { Megaphone, Send, Users, Check, X, AlertTriangle, RefreshCw } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { apiFetch } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import './MobileAdmin.css'

const OWNER_NPUB = '661419f8f48b1b496e2249aee97a6ad9d5bea907149dc7bf3eb7479f2bce555e'

const DEFAULT_MESSAGE = `Hey {name},

Joint Factory runs in rounds now, and your account is waiting for you.

A round ends at one quadrillion joints — about a week with managers and a few visits a day. Counting stops there, you start over, and you keep a star for it. The whole curve was rebuilt around that, so the numbers on your account come from a game that no longer exists. Nothing on it changes until you confirm once, and there is no deadline.

What you are credited: one finished round for every full quadrillion you ever earned, up to three. For most accounts that is none — the old curve ran 169 days and almost nobody reached the end of it. If that is you, nothing is lost: your first star comes from the first round you finish from here, and it is the same race for everyone.

Your sats are not touched. Neither are your deposits, your invite code or your referrals. The wallet stays open without confirming anything — if you would rather withdraw than start over, you can.

What else is new:

- A live race on the Grow page. Every lane runs to the same quadrillion, but the ranking is your projected round time, so starting earlier puts you further along the lane without winning it.
- One standings board with a podium: stars, your best quadrillion, and the joints of the round you are in.
- Managers are hired again each round and get cheaper every time you finish one: 90 sats, then 60, 30, and 21 from the fourth round on. Outdoor, Indoor and Hydroponic stop costing anything after the first, second and third.
- A lottery ticket now asks for one manager bought with sats in the round you are playing. Those sats are the pot you draw from.
- Speed is +5% on the whole chain per step and lasts to the end of the round.
- Six plots all matter now. A new plantation opens at half your highest level, so Greenhouse and MegaFarm are finally worth buying — you need them to finish.

https://jointfactory.io`

interface Recipient {
  npub: string
  name: string | null
  last_seen_at: number
  created_at: number
  sent_at: number | null
}

interface Campaign { campaign: string; sent: number; last_sent: number }

interface BroadcastInfo {
  ok: boolean
  recipients?: Recipient[]
  campaigns?: Campaign[]
  bot?: { pubkey: string; offline: boolean }
}

interface SendResult {
  dry_run: boolean
  campaign: string
  queued: number
  sent: number
  failed: number
  results: { name: string; ok: boolean; error?: string; dry_run?: boolean }[]
}

export default function MobileAdmin() {
  const auth = useAuth()
  const isOwner = auth.isLoggedIn && auth.npub === OWNER_NPUB

  const [campaign, setCampaign] = useState('rounds-v0.4')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [confirm, setConfirm] = useState('')
  const [limit, setLimit] = useState(0)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [bot, setBot] = useState<{ pubkey: string; offline: boolean } | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const [busy, setBusy] = useState<'dry' | 'live' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch(`/admin/broadcast?campaign=${encodeURIComponent(campaign)}`)
      .then((d: BroadcastInfo) => {
        if (!d.ok) return
        setRecipients(d.recipients || [])
        setCampaigns(d.campaigns || [])
        setBot(d.bot || null)
      })
      .catch(() => setError('Could not load recipients'))
  }, [campaign])

  useEffect(() => { if (isOwner) load() }, [isOwner, load])

  const pending = recipients.filter(r => !r.sent_at)
  const already = recipients.length - pending.length
  // A dry run for this exact campaign is what unlocks the real send.
  const dryDone = result?.dry_run === true && result.campaign === campaign
  const canSend = dryDone && confirm === campaign && pending.length > 0 && !busy

  async function run(live: boolean) {
    setBusy(live ? 'live' : 'dry')
    setError(null)
    try {
      const res = await apiFetch('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          message, campaign, dry_run: !live,
          limit: Number(limit) || 0,
          ...(live ? { confirm } : {}),
        }),
      })
      if (res.error) setError(res.error)
      else { setResult(res); if (live) { setConfirm(''); load() } }
    } catch {
      setError('Request failed')
    } finally {
      setBusy(null)
    }
  }

  if (!isOwner) {
    return (
      <div className="adm-page">
        <div className="adm-card adm-denied">
          <AlertTriangle size={20} />
          <span>This page belongs to the owner.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="adm-page">
      <div className="adm-head">
        <Megaphone size={22} />
        <h1>Broadcast</h1>
        {bot?.offline && <span className="adm-offline">bot offline — nothing will reach a relay</span>}
      </div>

      <div className="adm-card">
        <label className="adm-label">Campaign name</label>
        <input className="adm-input" value={campaign} onChange={e => { setCampaign(e.target.value); setResult(null) }} />
        <span className="adm-note">
          Anyone already written to under this name is skipped, so a second run
          continues rather than repeats. Change the name to reach everyone again.
        </span>
      </div>

      <div className="adm-card">
        <label className="adm-label">Message · <code>{'{name}'}</code> becomes the player's name</label>
        <textarea className="adm-textarea" rows={12} value={message} onChange={e => setMessage(e.target.value)} />
        <span className="adm-note">Sent as an encrypted NIP-04 DM from the bot, one per player, ~0.7 s apart.</span>
      </div>

      <div className="adm-card adm-counts">
        <div className="adm-count">
          <Users size={16} />
          <span className="adm-count-val">{pending.length}</span>
          <span className="adm-count-lbl">will receive</span>
        </div>
        <div className="adm-count">
          <Check size={16} />
          <span className="adm-count-val">{already}</span>
          <span className="adm-count-lbl">already had it</span>
        </div>
        <div className="adm-count">
          <span className="adm-count-val">{recipients.length}</span>
          <span className="adm-count-lbl">players total</span>
        </div>
        <button className="adm-refresh" onClick={load} title="Reload"><RefreshCw size={14} /></button>
      </div>

      <div className="adm-card">
        <label className="adm-label">Limit (0 = everyone) — try one first</label>
        <input className="adm-input adm-input-num" type="number" min={0} value={limit}
               onChange={e => setLimit(Number(e.target.value))} />

        <div className="adm-actions">
          <button className="adm-btn adm-btn-dry" onClick={() => run(false)} disabled={!!busy}>
            {busy === 'dry' ? 'Checking…' : 'Dry run'}
          </button>

          <div className="adm-live">
            <input className="adm-input adm-confirm" placeholder={`type "${campaign}" to unlock`}
                   value={confirm} onChange={e => setConfirm(e.target.value)} disabled={!dryDone} />
            <button className="adm-btn adm-btn-live" onClick={() => run(true)} disabled={!canSend}>
              <Send size={14} /> Send to {pending.length}
            </button>
          </div>
        </div>
        {!dryDone && <span className="adm-note">Do a dry run for this campaign first.</span>}
        {error && <span className="adm-error"><X size={13} /> {error}</span>}
      </div>

      {result && (
        <div className="adm-card">
          <div className="adm-result-head">
            {result.dry_run ? 'Dry run' : 'Sent'} · {result.sent}/{result.queued}
            {result.failed > 0 && <span className="adm-error"> · {result.failed} failed</span>}
          </div>
          <div className="adm-result-list">
            {result.results.map((r, i) => (
              <div key={i} className={`adm-result-row${r.ok ? '' : ' bad'}`}>
                {r.ok ? <Check size={12} /> : <X size={12} />}
                <span>{r.name}</span>
                {r.error && <span className="adm-error">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="adm-card">
          <div className="adm-label">Earlier campaigns</div>
          {campaigns.map(c => (
            <div key={c.campaign} className="adm-campaign">
              <span>{c.campaign}</span>
              <span className="adm-dim">{c.sent} sent · {fmtDateTime(c.last_sent)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="adm-card">
        <div className="adm-label">Recipients</div>
        <div className="adm-recipients">
          {recipients.map(r => (
            <div key={r.npub} className={`adm-recipient${r.sent_at ? ' done' : ''}`}>
              <span>{r.name || 'anon'}</span>
              <span className="adm-dim">
                {r.sent_at ? `sent ${fmtDateTime(r.sent_at)}` : `last seen ${fmtDateTime(r.last_seen_at)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
