import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Copy, Check, Gift, Zap, Shield, Clock, Users, ArrowLeft, MessageSquare } from 'lucide-react';
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


const PUBLISH_RELAYS = [
  'wss://relay.nsnip.io/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.snort.social/',
  'wss://relay.nostr.band/',
];

function buildPostText(inviteUrl: string) {
  return [
    "\u26a1 Joint Factory \u2014 Idle Tycoon on Nostr with Lightning Lottery",
    "",
    "Build your production chain, roll for sats and climb the leaderboard!",
    "",
    "\ud83d\udc49 " + inviteUrl,
    "",
    "#JointFactory #Bitcoin #Lightning #Nostr"
  ].join("\n");
}

async function publishToRelays(signedEvent: any): Promise<{ ok: number; fail: number }> {
  const results = await Promise.allSettled(
    PUBLISH_RELAYS.map(url => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]));
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (Array.isArray(data) && data[0] === 'OK') {
            clearTimeout(timeout);
            data[2] ? resolve() : reject(new Error(data[3] || 'rejected'));
            ws.close();
          }
        } catch {}
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('ws error')); };
    }))
  );
  return {
    ok: results.filter(r => r.status === 'fulfilled').length,
    fail: results.filter(r => r.status === 'rejected').length,
  };
}

function NostrShareCard({ inviteUrl, nostrCopied, setNostrCopied }: { inviteUrl: string; nostrCopied: boolean; setNostrCopied: (v: boolean) => void }) {
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [showNsec, setShowNsec] = useState(false);
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState('');

  const postText = buildPostText(inviteUrl);
  const hasExtension = typeof window !== 'undefined' && !!(window as any).nostr;

  const unsignedEvent = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: postText,
    tags: [
      ['t', 'JointFactory'],
      ['t', 'Bitcoin'],
      ['t', 'Lightning'],
      ['t', 'Nostr'],
    ],
  };

  async function postWithExtension() {
    setPosting(true);
    setError('');
    try {
      const signed = await (window as any).nostr.signEvent(unsignedEvent);
      const result = await publishToRelays(signed);
      if (result.ok > 0) {
        setPosted(`Published to ${result.ok} relay${result.ok > 1 ? 's' : ''}!`);
      } else {
        setError('No relay accepted the post. Try again later.');
      }
    } catch (err: any) {
      setError(err?.message || 'Signing failed');
    } finally {
      setPosting(false);
    }
  }

  async function postWithNsec() {
    if (!nsecInput.trim()) return;
    setPosting(true);
    setError('');
    try {
      const { finalizeEvent } = await import('nostr-tools/pure');
      const { decode } = await import('nostr-tools/nip19');
      let sk: Uint8Array;
      if (nsecInput.startsWith('nsec1')) {
        const decoded = decode(nsecInput.trim());
        if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
        sk = decoded.data;
      } else {
        throw new Error('Please enter a valid nsec key');
      }
      const signed = finalizeEvent(unsignedEvent, sk);
      const result = await publishToRelays(signed);
      if (result.ok > 0) {
        setPosted(`Published to ${result.ok} relay${result.ok > 1 ? 's' : ''}!`);
        setNsecInput('');
        setShowNsec(false);
      } else {
        setError('No relay accepted the post. Try again later.');
      }
    } catch (err: any) {
      setError(err?.message || 'Signing failed');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="invite-nostr-card">
      <div className="invite-nostr-header">
        <MessageSquare size={18} />
        <span>Share on Nostr</span>
      </div>
      <div className="invite-nostr-preview">{postText}</div>

      {posted ? (
        <div className="invite-nostr-success">
          <Check size={16} /> {posted}
        </div>
      ) : (
        <div className="invite-nostr-actions">
          <button className="invite-nostr-copy-btn" onClick={() => {
            navigator.clipboard.writeText(postText).then(() => {
              setNostrCopied(true);
              setTimeout(() => setNostrCopied(false), 2000);
            });
          }}>
            {nostrCopied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy</>}
          </button>

          {hasExtension && (
            <button className="invite-nostr-post-btn" onClick={postWithExtension} disabled={posting}>
              {posting ? 'Signing...' : <><Zap size={16} /> Post via Extension</>}
            </button>
          )}

          <button className="invite-nostr-nsec-toggle" onClick={() => setShowNsec(!showNsec)}>
            {showNsec ? 'Cancel' : 'Post with nsec'}
          </button>
        </div>
      )}

      {showNsec && !posted && (
        <div className="invite-nostr-nsec-row">
          <input
            className="invite-nostr-nsec-input"
            type="password"
            placeholder="nsec1..."
            value={nsecInput}
            onChange={e => setNsecInput(e.target.value)}
            autoComplete="off"
          />
          <button className="invite-nostr-post-btn" onClick={postWithNsec} disabled={posting || !nsecInput.trim()}>
            {posting ? 'Posting...' : 'Post'}
          </button>
        </div>
      )}

      {error && <div className="invite-nostr-error">{error}</div>}
    </div>
  );
}

export default function InvitePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [rewardedCount, setRewardedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [nostrCopied, setNostrCopied] = useState(false);

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

  const inviteUrl = inviteCode ? `${window.location.origin}/r/${inviteCode}` : '';

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


      {/* Nostr share template */}
      <NostrShareCard inviteUrl={inviteUrl} nostrCopied={nostrCopied} setNostrCopied={setNostrCopied} />

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
