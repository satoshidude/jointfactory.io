import { useState } from 'react';
import { Zap, Key, Sparkles, X, Plug, AlertTriangle } from 'lucide-react';
import { useAuth } from '../stores/authStore';
import { hasExtension, loginWithExtension, signWithNsec, generateKeypair, signWithSecretKey } from '../lib/nostr';
import { apiFetch } from '../lib/api';
import { fetchNostrProfile } from '../lib/nostrProfile';
import { fetchChallenge, solvePow } from '../lib/pow';
import './LoginModal.css';

type Tab = 'extension' | 'nsec' | 'new';

interface Props {
  onClose: () => void;
}

export default function LoginModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('extension');
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [powStatus, setPowStatus] = useState('');
  const [generated, setGenerated] = useState<{ nsec: string; npub: string; secretKey: Uint8Array } | null>(null);
  const auth = useAuth();

  async function doAuth(signedEvent: unknown) {
    setLoading(true);
    setError('');
    try {
      const referralCode = localStorage.getItem('jf_referral') || null;

      // First try without PoW (existing accounts don't need it)
      let res = await apiFetch('/auth/nostr', {
        method: 'POST',
        body: JSON.stringify({ event: signedEvent, referral_code: referralCode }),
      });

      // If PoW required (new account), solve challenge and retry
      if (!res.ok && res.error === 'Proof of work required') {
        setPowStatus('Mining your access...');
        const { challenge, difficulty } = await fetchChallenge();
        const nonce = await solvePow(challenge, difficulty);
        setPowStatus('');
        res = await apiFetch('/auth/nostr', {
          method: 'POST',
          body: JSON.stringify({ event: signedEvent, referral_code: referralCode, pow_challenge: challenge, pow_nonce: nonce }),
        });
      }
      if (!res.ok) {
        setError(res.error || 'Login failed');
        return;
      }
      localStorage.removeItem('jf_referral');
      auth.login(res.token, res.player.npub, res.player.display_name || null, res.player.lightning_address || null, res.player.sats, res.player.joints, res.player.total_joints_earned || 0, !!res.is_new, res.player.total_deposited || 0);
      onClose();
      // Background: fetch Nostr profile and sync account fields
      fetchNostrProfile(res.player.npub).then(profile => {
        console.log('[Login] Nostr profile fetched:', profile)
        const newName = profile.display_name || profile.name
        const newLn = profile.lud16 || profile.nip05
        const currentName = res.player.display_name
        const currentLn = res.player.lightning_address
        const updates: Record<string, string | null> = {}
        if (newName) updates.display_name = newName
        if (newLn && !currentLn) updates.lightning_address = newLn
        if (Object.keys(updates).length > 0) {
          console.log('[Login] Syncing profile updates:', updates)
          apiFetch('/game/profile', {
            method: 'POST',
            body: JSON.stringify(updates),
          }).then(r => {
            console.log('[Login] Profile update response:', r)
            if (r.ok) {
              auth.setProfile(
                updates.display_name || currentName || null,
                updates.lightning_address || currentLn || null,
              )
            }
          }).catch(e => console.error('[Login] Profile update failed:', e))
        } else {
          console.log('[Login] No profile updates needed')
        }
      }).catch(e => console.error('[Login] Nostr profile fetch failed:', e))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  }

  async function handleExtension() {
    if (!hasExtension()) {
      setError('No Nostr extension found. Install Alby, nos2x, or Flamingo.');
      return;
    }
    try {
      const event = await loginWithExtension();
      await doAuth(event);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Extension error');
    }
  }

  async function handleNsec() {
    if (!nsecInput.trim()) return;
    try {
      const event = await signWithNsec(nsecInput.trim());
      await doAuth(event);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid nsec');
    }
  }

  async function handleGenerate() {
    try {
      const kp = await generateKeypair();
      setGenerated(kp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Key generation failed');
    }
  }

  async function handleLoginWithGenerated() {
    if (!generated) return;
    try {
      const event = await signWithSecretKey(generated.secretKey);
      await doAuth(event);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="login-modal" onClick={e => e.stopPropagation()}>
        <div className="login-modal-header">
          <h2><Zap size={18} /> Login</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="login-tabs">
          <button className={`login-tab ${tab === 'extension' ? 'active' : ''}`} onClick={() => { setTab('extension'); setError(''); }}>
            <Plug size={14} /> Extension
          </button>
          <button className={`login-tab ${tab === 'nsec' ? 'active' : ''}`} onClick={() => { setTab('nsec'); setError(''); }}>
            <Key size={14} /> nsec
          </button>
          <button className={`login-tab ${tab === 'new' ? 'active' : ''}`} onClick={() => { setTab('new'); setError(''); setGenerated(null); }}>
            <Sparkles size={14} /> New
          </button>
        </div>

        <div className="login-body">
          {tab === 'extension' && (
            <>
              <p className="login-hint">
                Use your browser extension (Alby, nos2x, Flamingo).<br />
                You will be asked to sign a message.
              </p>
              <button className="login-action" onClick={handleExtension} disabled={loading}>
                <Plug size={16} /> {loading ? 'Connecting...' : 'Connect with Extension'}
              </button>
            </>
          )}

          {tab === 'nsec' && (
            <>
              <p className="login-hint">
                <AlertTriangle size={14} className="warning-icon" />
                Your nsec never leaves the browser — it is only used locally to sign.
              </p>
              <label className="login-label">nsec (private key)</label>
              <input
                className="login-input"
                type="password"
                placeholder="nsec1..."
                value={nsecInput}
                onChange={e => setNsecInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNsec()}
              />
              <button className="login-action" onClick={handleNsec} disabled={loading || !nsecInput.trim()}>
                <Key size={16} /> {loading ? 'Signing in...' : 'Login'}
              </button>
            </>
          )}

          {tab === 'new' && !generated && (
            <>
              <p className="login-hint">
                Generate a new Nostr keypair directly in your browser.
              </p>
              <p className="login-warning">Write down your nsec — it will only be shown once!</p>
              <button className="login-action" onClick={handleGenerate} disabled={loading}>
                <Sparkles size={16} /> Generate New Keypair
              </button>
            </>
          )}

          {tab === 'new' && generated && (
            <>
              <label className="login-label">Your nsec (private key) — save this!</label>
              <div className="generated-key nsec">{generated.nsec}</div>
              <label className="login-label">Your npub (public key)</label>
              <div className="generated-key npub">{generated.npub}</div>
              <button className="login-action" onClick={handleLoginWithGenerated} disabled={loading}>
                <Zap size={16} /> {loading ? 'Logging in...' : 'Login with new key'}
              </button>
            </>
          )}

          {/* Honeypot — invisible to humans, bots fill it */}
          <input type="text" name="website" autoComplete="off" tabIndex={-1}
            style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }} />

          {powStatus && <p className="login-pow-status">{powStatus}</p>}
          {error && <p className="login-error">{error}</p>}
        </div>

        <div className="login-footer">
          <button className="login-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
