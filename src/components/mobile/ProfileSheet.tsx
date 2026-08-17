import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Save, Loader, LogOut, Zap, User } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { apiFetch } from '../../lib/api'
import './ProfileSheet.css'

interface Props {
  onClose: () => void
}

export default function ProfileSheet({ onClose }: Props) {
  const auth = useAuth()
  const navigate = useNavigate()
  const [editName, setEditName] = useState(auth.displayName || '')
  const [editLn, setEditLn] = useState(auth.lightningAddress || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

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
    onClose()
    navigate('/')
  }

  return (
    <div className="profile-sheet-overlay" onClick={onClose}>
      <div className="profile-sheet" onClick={e => e.stopPropagation()}>
        <div className="profile-sheet-header">
          <h2><User size={16} /> Profile</h2>
          <button className="profile-sheet-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="profile-sheet-body">
          <label className="profile-sheet-label">Display Name</label>
          <input
            className="profile-sheet-input"
            placeholder="Anonymous"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />

          <label className="profile-sheet-label">
            <Zap size={12} /> Lightning Address
          </label>
          <input
            className="profile-sheet-input"
            placeholder="user@wallet.com"
            value={editLn}
            onChange={e => setEditLn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />

          <button className="profile-sheet-save" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader size={14} className="spin" /> Saving...</> :
             saved ? <><Save size={14} /> Saved!</> :
             <><Save size={14} /> Save</>}
          </button>
          {error && <p className="profile-sheet-error">{error}</p>}
        </div>

        <div className="profile-sheet-footer">
          <button className="profile-sheet-logout" onClick={handleLogout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    </div>
  )
}
