import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cannabis, Zap, LogIn, LogOut, Bird, Info, Landmark, UserPlus, Github } from 'lucide-react';
import { useAuth } from '../stores/authStore';
import { useGameDisplay } from '../stores/gameDisplayStore';
import { apiFetch } from '../lib/api';
import { nip19 } from 'nostr-tools';
import LoginModal from './LoginModal';
import './Header.css';

function fmtNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

export default function Header() {
  const auth = useAuth();
  const gd = useGameDisplay();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);


  // Background polling for pending deposits
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!auth.isLoggedIn) return;
    function checkPending() {
      try {
        const raw = localStorage.getItem('jf_pending_payment');
        if (!raw) { if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; } return; }
        const p = JSON.parse(raw);
        if (Date.now() - p.ts > 15 * 60 * 1000) { localStorage.removeItem('jf_pending_payment'); return; }
        apiFetch(`/lightning/status/${p.hash}`).then(status => {
          if (status.paid) {
            localStorage.removeItem('jf_pending_payment');
            apiFetch('/game/state').then(state => {
              if (state?.sats !== undefined) auth.setSats(state.sats);
            });
          }
        });
      } catch { /* ignore */ }
    }
    checkPending();
    bgPollRef.current = setInterval(checkPending, 3000);
    return () => { if (bgPollRef.current) clearInterval(bgPollRef.current); };
  }, [auth.isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const joints = gd.joints || auth.joints;
  const sats = gd.sats || auth.sats;

  return (
    <>
      <header className="header">
        <Cannabis size={36} style={{ color: 'var(--neon-green)', filter: 'drop-shadow(0 0 8px rgba(57,255,20,.5))' }} />
        <span className="overview-title" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>JOINT FACTORY</span>
        <span className="overview-version">v0.2</span>

        {auth.isLoggedIn ? (
          <>
            <div className="overview-resources">
              <div className="resource">
                <div>
                  <span className="resource-value text-purple">{fmtNum(joints)}</span>
                  <span className="resource-label"> JOINTS</span>
                </div>
              </div>
              <div className="resource">
                <div>
                  <span className="resource-value text-factory-purple">{fmtNum(gd.cannabisAtFactory)}</span>
                  <span className="resource-label"> FACTORY</span>
                </div>
              </div>
              <div className="resource">
                <div>
                  <span className="resource-value text-cannabis">{fmtNum(gd.cannabis + gd.cannabisAtFactory + gd.courierCarrying)}</span>
                  <span className="resource-label"> WEED</span>
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <Zap size={22} className="overview-sats-icon" />
            <div className="resource">
              <div>
                <span className="resource-value text-gold">{Math.floor(sats).toLocaleString()}</span>
                <span className="resource-label"> SATS</span>
              </div>
            </div>
            <div className="overview-wallet-btns">
              <button className="overview-wallet-btn" title="Wallet" onClick={() => navigate('/wallet')}>
                <Landmark size={16} />
              </button>
            </div>
            <div className="overview-user-section">
              <a href="https://nostr.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="overview-wallet-btn nostr-btn" title="Joint Factory on Nostr">
                <Bird size={16} />
              </a>
              <a href="https://github.com/satoshidude/jointfactory.io" target="_blank" rel="noopener noreferrer" className="overview-wallet-btn github-btn" title="Source Code on GitHub">
                <Github size={16} />
              </a>
              <button className="overview-wallet-btn invite-btn" title="Invite a Buddy" onClick={() => navigate('/invite')}>
                <UserPlus size={16} />
              </button>
              <button className="overview-wallet-btn" title="Info" onClick={() => navigate('/info')}>
                <Info size={16} />
              </button>
              <button className="overview-user-btn" onClick={() => {
                let encoded = auth.npub || '';
                try { encoded = nip19.npubEncode(auth.npub!); } catch {}
                navigate(`/u/${encoded}`);
              }}>
                <Bird size={14} className="flamingo-icon" />
                <span>{auth.displayName || 'noname'}</span>
              </button>
              <button className="overview-wallet-btn" title="Logout" onClick={auth.logout}>
                <LogOut size={16} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="resource">
              <div>
                <span className="resource-value text-purple">{fmtNum(joints)}</span>
                <span className="resource-label"> JOINTS</span>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <span className="overview-login-animated">Login for auto manager and speed upgrades!</span>
            <div style={{ flex: 1 }} />
            <div className="overview-user-section">
              <a href="https://nostr.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="overview-wallet-btn nostr-btn" title="Joint Factory on Nostr">
                <Bird size={16} />
              </a>
              <a href="https://github.com/satoshidude/jointfactory.io" target="_blank" rel="noopener noreferrer" className="overview-wallet-btn github-btn" title="Source Code on GitHub">
                <Github size={16} />
              </a>
              <button className="overview-wallet-btn invite-btn" title="Invite a Buddy" onClick={() => navigate('/invite')}>
                <UserPlus size={16} />
              </button>
              <button className="overview-wallet-btn" title="Info" onClick={() => navigate('/info')}>
                <Info size={16} />
              </button>
              <button className="overview-login-btn" onClick={() => setShowLogin(true)}>
                <LogIn size={16} />
                <span>Login</span>
              </button>
            </div>
          </>
        )}
      </header>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

    </>
  );
}
