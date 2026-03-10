import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Copy, Check, Gift, Zap, Shield, Clock, Users, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';
import './Invite.css';

interface Referral {
  display_name: string | null;
  created_at: number;
  rewarded: boolean;
  managers: number;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function InvitePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [rewardedCount, setRewardedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch('/player/invite')
      .then((d: any) => {
        if (d.ok) {
          setInviteCode(d.invite_code || '');
          setReferrals(d.referrals || []);
          setRewardedCount(d.rewarded_count || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const inviteUrl = inviteCode ? `${window.location.origin}/?ref=${inviteCode}` : '';

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!auth.isLoggedIn) {
    return (
      <div className="invite-page">
        <div className="invite-hero">
          <div className="invite-hero-glow" />
          <div className="invite-hero-icon-wrap">
            <div className="invite-hero-icon">
              <UserPlus size={48} />
            </div>
          </div>
          <h1 className="invite-hero-title">Invite a Buddy</h1>
          <p className="invite-hero-subtitle">
            Sign in to get your personal invite link and start earning sats!
          </p>
          <div className="invite-hero-perks">
            <div className="invite-perk">
              <Gift size={20} />
              <span>Free auto-manager</span>
            </div>
            <div className="invite-perk gold">
              <Zap size={20} />
              <span>10 sats per buddy</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="invite-page">
      <button className="info-back" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Back to Game
      </button>
      {/* Hero */}
      <div className="invite-hero">
        <div className="invite-hero-glow" />
        <div className="invite-hero-icon-wrap">
          <div className="invite-hero-icon">
            <UserPlus size={48} />
          </div>
        </div>
        <h1 className="invite-hero-title">Invite a Buddy</h1>
        <p className="invite-hero-subtitle">
          Share your link and earn rewards when your buddies reach 3 auto-managers
        </p>
      </div>

      {/* Reward cards */}
      <div className="invite-rewards-row">
        <div className="invite-reward-card first">
          <div className="invite-reward-badge">1st Buddy</div>
          <Gift size={28} className="invite-reward-icon" />
          <span className="invite-reward-text">Free auto-manager</span>
          <span className="invite-reward-plus">+ 10 sats for both</span>
        </div>
        <div className="invite-reward-card every">
          <div className="invite-reward-badge">Every Buddy</div>
          <Zap size={28} className="invite-reward-icon gold" />
          <span className="invite-reward-text gold">10 sats</span>
          <span className="invite-reward-plus">for you and your buddy</span>
        </div>
      </div>

      {/* Stats */}
      <div className="invite-stats-row">
        <div className="invite-stat-card">
          <Users size={18} />
          <span className="invite-stat-val">{referrals.length}</span>
          <span className="invite-stat-lbl">Invited</span>
        </div>
        <div className="invite-stat-card">
          <Shield size={18} />
          <span className="invite-stat-val green">{rewardedCount}</span>
          <span className="invite-stat-lbl">Rewarded</span>
        </div>
        <div className="invite-stat-card">
          <Zap size={18} />
          <span className="invite-stat-val gold">+{rewardedCount * 10}</span>
          <span className="invite-stat-lbl">Sats Earned</span>
        </div>
      </div>

      {/* Invite link */}
      <div className="invite-link-card">
        <label className="invite-link-label">Your invite link</label>
        <div className="invite-link-row">
          <input className="invite-link-input" readOnly value={inviteUrl} />
          <button className="invite-copy-btn" onClick={copyLink}>
            {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy</>}
          </button>
        </div>
      </div>

      {/* Referral list */}
      {loading ? (
        <div className="invite-loading">Loading...</div>
      ) : referrals.length > 0 ? (
        <div className="invite-buddies-card">
          <h3 className="invite-buddies-title">Your Buddies</h3>
          <div className="invite-buddies-list">
            {referrals.map((r, i) => (
              <div key={i} className={`invite-buddy-row${r.rewarded ? ' rewarded' : ''}`}>
                <div className="invite-buddy-info">
                  <span className="invite-buddy-name">{r.display_name || 'Unknown'}</span>
                  <span className="invite-buddy-meta">
                    <Clock size={10} /> {timeAgo(r.created_at)}
                    <span className="invite-buddy-mgrs">
                      <Shield size={10} /> {r.managers}/3 managers
                    </span>
                  </span>
                </div>
                <div className="invite-buddy-status">
                  {r.rewarded ? (
                    <span className="invite-buddy-done"><Zap size={14} /> +10 sats</span>
                  ) : (
                    <span className="invite-buddy-pending">{3 - r.managers} manager{3 - r.managers !== 1 ? 's' : ''} to go</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
