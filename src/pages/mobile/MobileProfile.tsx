import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Save, Loader, LogOut, User, Ticket, TrendingUp, Trash2, Globe } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { apiFetch } from '../../lib/api'
import LoginModal from '../../components/LoginModal'
import '../PlayerProfile.css'
import './MobilePages.css'

function fmtNum(n: number): string {
  if (n >= 1e15) return (n / 1e15).toFixed(2) + '\u2009Qa'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + '\u2009T'
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + '\u2009B'
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + '\u2009M'
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + '\u2009K'
  return Math.floor(n).toLocaleString()
}

function fmtRate(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + '\u2009M/s'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + '\u2009K/s'
  if (n >= 1)   return n.toFixed(1) + '/s'
  if (n > 0)    return n.toFixed(3) + '/s'
  return '0/s'
}

interface Stats {
  rank: number
  total_players: number
  total_joints_earned: number
  joints_per_sec: number
  total_sats_won: number
  total_tickets: number
}

export default function MobileProfile() {
  const auth = useAuth()
  const gd = useGameDisplay()
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)

  // Edit state
  const [editName, setEditName] = useState(auth.displayName || '')
  const [editLn, setEditLn] = useState(auth.lightningAddress || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Stats
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!auth.isLoggedIn || !auth.npub) return
    const base = import.meta.env.VITE_API_URL || ''
    // Use nip19 to encode npub for API
    import('nostr-tools').then(({ nip19 }) => {
      const npubEncoded = nip19.npubEncode(auth.npub!)
      fetch(`${base}/api/player/${npubEncoded}/public`)
        .then(r => r.json())
        .then(data => {
          if (!data.ok) return
          setStats({
            rank: data.production?.rank || 0,
            total_players: data.production?.total_players || 0,
            total_joints_earned: data.production?.total_joints_earned || 0,
            joints_per_sec: data.production?.joints_per_sec || 0,
            total_sats_won: data.lottery?.total_sats_won || 0,
            total_tickets: data.lottery?.total_tickets_purchased || 0,
          })
        })
        .catch(() => {})
    })
  }, [auth.isLoggedIn, auth.npub])

  useEffect(() => {
    setEditName(auth.displayName || '')
    setEditLn(auth.lightningAddress || '')
  }, [auth.displayName, auth.lightningAddress])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await apiFetch('/game/profile', {
        method: 'POST',
        body: JSON.stringify({
          display_name: editName.trim() || null,
          lightning_address: editLn.trim() || null,
        }),
      })
      if (!res.ok) { setError(res.reason || 'Save failed'); return }
      auth.setProfile(editName.trim() || null, editLn.trim() || null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error')
    } finally {
      setSaving(false)
    }
  }

  function handleLogout() {
    auth.logout()
    navigate('/')
  }

  async function handleDelete() {
    if (!window.confirm('Delete your account? All data, stats and sats will be lost. This cannot be undone.')) return
    if (!window.confirm('Are you really sure? This is permanent.')) return
    try {
      const res = await apiFetch('/game/profile', { method: 'DELETE' })
      if (res.ok) {
        auth.logout()
        navigate('/')
      } else {
        setError(res.reason || 'Delete failed')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error')
    }
  }

  if (!auth.isLoggedIn) {
    return (
      <div className="mobile-page mobile-profile">
        <div className="mp-guest">
          <User size={48} className="mp-guest-icon" />
          <h2 className="mp-guest-title">Account</h2>
          <p className="mp-guest-sub">Sign in to see your stats, edit your name, and manage your account.</p>
          <button className="mp-login-btn" onClick={() => setShowLogin(true)}>Sign in</button>
        </div>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </div>
    )
  }

  return (
    <div className="mobile-page mobile-profile">
      {/* Logout */}
      <button className="mp-logout-btn" onClick={handleLogout}>
        <LogOut size={16} /> Logout
      </button>

      {/* Edit Profile */}
      <div className="mp-card">
        <div className="mp-card-header-row">
          <h3 className="mp-card-title"><User size={16} /> Account</h3>
          <button className="mp-nostr-btn" onClick={() => navigate('/profile/nostr')}>
            <Globe size={12} /> Nostr Profile
          </button>
        </div>
        <label className="mp-label">Display Name</label>
        <input
          className="mp-input"
          placeholder="Anonymous"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />
        <label className="mp-label">
          <Zap size={12} /> Lightning Address
        </label>
        <input
          className="mp-input"
          placeholder="user@wallet.com"
          value={editLn}
          onChange={e => setEditLn(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />
        <button className="mp-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader size={14} className="spin" /> Saving...</> :
           saved ? <><Save size={14} /> Saved!</> :
           <><Save size={14} /> Save</>}
        </button>
        <button className="mp-delete-btn" onClick={handleDelete}>
          <Trash2 size={14} /> Delete Account
        </button>
        {error && <p className="mp-error">{error}</p>}
      </div>

      {/* Stats */}
      <div className="mp-card">
        <h3 className="mp-card-title"><TrendingUp size={16} /> Stats</h3>
        <div className="mp-stats-grid">
          <div className="mp-stat">
            <span className="mp-stat-val green">{fmtNum(gd.joints || auth.joints)}</span>
            <span className="mp-stat-lbl">Joints</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-val gold">{Math.floor(auth.sats).toLocaleString()}</span>
            <span className="mp-stat-lbl">Sats</span>
          </div>
          {stats && (
            <>
              <div className="mp-stat">
                <span className="mp-stat-val">#{stats.rank}</span>
                <span className="mp-stat-lbl">Rank of {stats.total_players}</span>
              </div>
              <div className="mp-stat">
                <span className="mp-stat-val green">{fmtRate(stats.joints_per_sec)}</span>
                <span className="mp-stat-lbl">Production</span>
              </div>
              <div className="mp-stat">
                <span className="mp-stat-val">{fmtNum(stats.total_joints_earned)}</span>
                <span className="mp-stat-lbl">Total Earned</span>
              </div>
              <div className="mp-stat">
                <span className="mp-stat-val gold">{stats.total_sats_won.toLocaleString()}</span>
                <span className="mp-stat-lbl">Sats Won</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lottery Stats */}
      {stats && stats.total_tickets > 0 && (
        <div className="mp-card">
          <h3 className="mp-card-title"><Ticket size={16} /> Lottery</h3>
          <div className="mp-stats-grid">
            <div className="mp-stat">
              <span className="mp-stat-val">{stats.total_tickets}</span>
              <span className="mp-stat-lbl">Tickets Bought</span>
            </div>
            <div className="mp-stat">
              <span className="mp-stat-val gold">{stats.total_sats_won.toLocaleString()}</span>
              <span className="mp-stat-lbl">Sats Won</span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
