import { useState, useMemo } from 'react';
import { X, User, Zap, Save, Loader, Copy, Check } from 'lucide-react';
import { useAuth } from '../stores/authStore';
import { apiFetch } from '../lib/api';
import { nip19 } from 'nostr-tools';
import './ProfileModal.css';

interface Props {
  onClose: () => void;
}

export default function ProfileModal({ onClose }: Props) {
  const auth = useAuth();
  const [name, setName] = useState(auth.displayName || '');
  const [lnAddress, setLnAddress] = useState(auth.lightningAddress || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setLoading(true);
    setError('');
    setSaved(false);
    try {
      const res = await apiFetch('/game/profile', {
        method: 'POST',
        body: JSON.stringify({
          display_name: name.trim() || null,
          lightning_address: lnAddress.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(res.reason || 'Save failed');
        return;
      }
      auth.setProfile(name.trim() || null, lnAddress.trim() || null);
      setSaved(true);
      setTimeout(() => onClose(), 800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  }

  const hexPubkey = auth.npub || '';
  const npubEncoded = useMemo(() => {
    if (!hexPubkey) return '';
    try {
      return nip19.npubEncode(hexPubkey);
    } catch { return ''; }
  }, [hexPubkey]);

  const [copiedField, setCopiedField] = useState<string | null>(null);

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  function shorten(s: string): string {
    if (s.length <= 24) return s;
    return s.slice(0, 14) + '...' + s.slice(-8);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>
        <div className="profile-header">
          <h2><User size={18} /> Profile</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="profile-body">
          <div className="profile-key-block">
            <div className="profile-key-row">
              <span className="profile-key-label">npub</span>
              <span className="profile-key-value">{shorten(npubEncoded)}</span>
              <button className="profile-copy-btn" onClick={() => copyToClipboard(npubEncoded, 'npub')}>
                {copiedField === 'npub' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="profile-key-row">
              <span className="profile-key-label">hex</span>
              <span className="profile-key-value">{shorten(hexPubkey)}</span>
              <button className="profile-copy-btn" onClick={() => copyToClipboard(hexPubkey, 'hex')}>
                {copiedField === 'hex' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          <label className="profile-label">Display Name</label>
          <input
            className="profile-input"
            placeholder="noname"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            autoFocus
          />

          <label className="profile-label">
            <Zap size={12} className="profile-label-icon" /> Lightning Address
          </label>
          <input
            className="profile-input"
            placeholder="user@wallet.com"
            value={lnAddress}
            onChange={e => setLnAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />

          <button className="profile-save" onClick={handleSave} disabled={loading}>
            {loading ? (
              <><Loader size={16} className="spin" /> Saving...</>
            ) : saved ? (
              <><Save size={16} /> Saved!</>
            ) : (
              <><Save size={16} /> Save</>
            )}
          </button>

          {error && <p className="profile-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
