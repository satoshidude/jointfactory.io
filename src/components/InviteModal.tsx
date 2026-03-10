import { useState, useEffect } from 'react';
import { X, UserPlus, Copy, Check, Gift, Zap, Shield, Clock } from 'lucide-react';
import { apiFetch } from '../lib/api';
import './InviteModal.css';

interface Referral {
  display_name: string | null;
  created_at: number;
  rewarded: boolean;
  managers: number;
}

interface Props {
  onClose: () => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function InviteModal({ onClose }: Props) {
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={e => e.stopPropagation()}>
        <div className="invite-header">
          <h2><UserPlus size={20} /> Invite a Buddy</h2>
          <button className="invite-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="invite-body">
          <div className="invite-reward">
            <Gift size={18} className="invite-reward-icon" />
            <div>
              <strong>1st buddy with 3 managers</strong> → free auto-manager for you!<br />
              <strong>Every buddy with 3 managers</strong> → 10 sats for both of you
            </div>
          </div>

          <div className="invite-progress">
            <span className="invite-progress-label">Referrals</span>
            <span className="invite-progress-count">{referrals.length} / 10</span>
            <span className="invite-progress-sep">·</span>
            <span className="invite-progress-label">Rewarded</span>
            <span className="invite-progress-count reward">{rewardedCount} / 10</span>
            <span className="invite-progress-sep">·</span>
            <Zap size={12} className="invite-sats-icon" />
            <span className="invite-progress-count sats">+{rewardedCount * 10}</span>
          </div>

          {loading ? (
            <div className="invite-loading">Loading...</div>
          ) : (
            <>
              <div className="invite-link-section">
                <label className="invite-label">Your invite link</label>
                <div className="invite-link-row">
                  <input className="invite-link-input" readOnly value={inviteUrl} />
                  <button className="invite-copy-btn" onClick={copyLink}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {referrals.length > 0 && (
                <div className="invite-referrals">
                  <div className="invite-referrals-title">
                    Invited buddies
                  </div>
                  {referrals.map((r, i) => (
                    <div className={`invite-referral-row${r.rewarded ? ' rewarded' : ''}`} key={i}>
                      <div className="invite-ref-left">
                        <span className="invite-referral-name">{r.display_name || 'Unknown'}</span>
                        <span className="invite-referral-meta">
                          <Clock size={10} /> {timeAgo(r.created_at)}
                          <span className="invite-ref-mgrs">
                            <Shield size={10} /> {r.managers}/3
                          </span>
                        </span>
                      </div>
                      <div className="invite-ref-right">
                        {r.rewarded ? (
                          <span className="invite-ref-status done"><Zap size={12} /> +10 sats</span>
                        ) : (
                          <span className="invite-ref-status pending">{3 - r.managers} mgr to go</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
