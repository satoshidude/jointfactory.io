import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Trophy, Zap, ArrowLeft, Circle, Cannabis, Truck, Factory, Shield, Ticket, Clock, Calendar, ExternalLink, User, Save, Loader, Copy, Check } from 'lucide-react';
import { useAuth } from '../stores/authStore';
import { apiFetch } from '../lib/api';
import { nip19 } from 'nostr-tools';
import './PlayerProfile.css';

interface PlayerData {
  npub: string;
  npub_encoded: string;
  display_name: string | null;
  avatar: string | null;
  nip05: string | null;
  created_at: number;
  last_seen_at: number;
  is_online: boolean;
}

interface ProductionData {
  joints: number;
  total_joints_earned: number;
  joints_per_sec: number;
  rank: number;
  total_players: number;
}

interface StationData {
  plantations: { name: string; icon: string; level: number; has_manager: boolean }[];
  courier: { capacity: number; speed_level: number; has_manager: boolean } | null;
  fabrik: { capacity: number; speed_level: number; has_manager: boolean } | null;
  manager_count: number;
}

interface LotteryWin {
  round_id: number;
  amount_sats: number;
  draws_at: number;
}

interface LotteryData {
  total_tickets_purchased: number;
  total_sats_won: number;
  wins: LotteryWin[];
}

function fmtNum(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + '\u2009T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + '\u2009B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + '\u2009M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + '\u2009K';
  return Math.floor(n).toLocaleString();
}

function fmtRate(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + '\u2009M/s';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + '\u2009K/s';
  if (n >= 1)   return n.toFixed(1) + '/s';
  if (n > 0)    return n.toFixed(3) + '/s';
  return '0/s';
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PlayerProfile() {
  const { npub } = useParams<{ npub: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [production, setProduction] = useState<ProductionData | null>(null);
  const [stations, setStations] = useState<StationData | null>(null);
  const [lottery, setLottery] = useState<LotteryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit profile state
  const [editName, setEditName] = useState('');
  const [editLnAddress, setEditLnAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Live interpolation refs
  const jointsRef = useRef(0);
  const rateRef = useRef(0);
  const updatedAtRef = useRef(Date.now());
  const [liveJoints, setLiveJoints] = useState(0);

  useEffect(() => {
    if (!npub) return;
    const base = import.meta.env.VITE_API_URL || '';
    fetch(`${base}/api/player/${npub}/public`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok) { setError(data.error || 'Not found'); setLoading(false); return; }
        setPlayer(data.player);
        setProduction(data.production);
        setStations(data.stations);
        setLottery(data.lottery);
        jointsRef.current = data.production.joints;
        rateRef.current = data.production.joints_per_sec;
        updatedAtRef.current = Date.now();
        setLiveJoints(data.production.joints);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load'); setLoading(false); });
  }, [npub]);

  // Check if viewing own profile
  const isOwnProfile = (() => {
    if (!auth.npub || !player) return false;
    try {
      return nip19.npubEncode(auth.npub) === player.npub_encoded || auth.npub === player.npub;
    } catch { return auth.npub === player.npub; }
  })();

  // Initialize edit fields when player data loads
  useEffect(() => {
    if (isOwnProfile && player) {
      setEditName(player.display_name || '');
      setEditLnAddress(auth.lightningAddress || '');
    }
  }, [isOwnProfile, player, auth.lightningAddress]);

  // Animate joints counter
  useEffect(() => {
    if (!player?.is_online || rateRef.current <= 0) return;
    let animId: number;
    const tick = () => {
      const elapsed = (Date.now() - updatedAtRef.current) / 1000;
      setLiveJoints(jointsRef.current + elapsed * rateRef.current);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [player?.is_online]);

  if (loading) return <div className="pp-page"><div className="pp-loading">Loading...</div></div>;
  if (error || !player) return (
    <div className="pp-page">
      <button className="info-back" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>
      <div className="pp-error">{error || 'Player not found'}</div>
    </div>
  );

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const res = await apiFetch('/game/profile', {
        method: 'POST',
        body: JSON.stringify({
          display_name: editName.trim() || null,
          lightning_address: editLnAddress.trim() || null,
        }),
      });
      if (!res.ok) { setSaveError(res.reason || 'Save failed'); return; }
      auth.setProfile(editName.trim() || null, editLnAddress.trim() || null);
      if (player) setPlayer({ ...player, display_name: editName.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete your account? All data, stats and sats will be lost. This cannot be undone.')) return;
    if (!confirm('Are you really sure? This is permanent.')) return;
    try {
      const res = await apiFetch('/game/profile', { method: 'DELETE' });
      if (res.ok) {
        auth.logout();
        navigate('/');
      } else {
        setSaveError(res.reason || 'Delete failed');
      }
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Connection error');
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  const shortNpub = player.npub_encoded.slice(0, 12) + '...' + player.npub_encoded.slice(-4);
  const rankIcon = production?.rank === 1 ? 'gold' : production?.rank === 2 ? 'silver' : production?.rank === 3 ? 'bronze' : null;

  return (
    <div className="pp-page">
      <button className="info-back" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Back
      </button>

      {/* Hero */}
      <div className="pp-hero">
        <div className="pp-hero-glow" />
        <div className="pp-avatar">
          {player.avatar ? <img src={player.avatar} alt="" /> : <Cannabis size={40} />}
        </div>
        <h1 className="pp-name">{player.display_name || 'Anonymous'}</h1>
        <div className="pp-npub">
          <span>{shortNpub}</span>
          {player.is_online && <Circle size={8} className="pp-online-dot" />}
        </div>
        {player.nip05 && <div className="pp-nip05">{player.nip05}</div>}
        <div className="pp-meta">
          <span><Calendar size={12} /> Joined {fmtDate(player.created_at)}</span>
          <span><Clock size={12} /> {player.is_online ? 'Online now' : `Last seen ${timeAgo(player.last_seen_at)}`}</span>
        </div>
        <a className="pp-jumble-link" href={`https://jumble.nsnip.io/users/${player.npub_encoded}`} target="_blank" rel="noopener noreferrer">
          View on Nostr <ExternalLink size={10} />
        </a>
      </div>

      {/* Edit Profile (own profile only) */}
      {isOwnProfile && (
        <div className="pp-card pp-edit-card">
          <h2 className="pp-card-title"><User size={16} /> Edit Profile</h2>
          <div className="pp-key-block">
            <div className="pp-key-row">
              <span className="pp-key-label">npub</span>
              <span className="pp-key-value">{shortNpub}</span>
              <button className="pp-copy-btn" onClick={() => copyToClipboard(player.npub_encoded, 'npub')}>
                {copiedField === 'npub' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
          <label className="pp-edit-label">Display Name</label>
          <input
            className="pp-edit-input"
            placeholder="noname"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <label className="pp-edit-label">
            <Zap size={12} className="pp-edit-label-icon" /> Lightning Address
          </label>
          <input
            className="pp-edit-input"
            placeholder="user@wallet.com"
            value={editLnAddress}
            onChange={e => setEditLnAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button className="pp-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader size={16} className="spin" /> Saving...</> :
             saved ? <><Save size={16} /> Saved!</> :
             <><Save size={16} /> Save</>}
          </button>
          {saveError && <p className="pp-save-error">{saveError}</p>}
          <button className="pp-delete-btn" onClick={handleDelete}>
            Delete Account
          </button>
        </div>
      )}

      {/* Production Stats */}
      {production && (
        <div className="pp-card">
          <h2 className="pp-card-title"><Cannabis size={16} /> Production</h2>
          <div className="pp-stats-grid">
            <div className="pp-stat">
              <span className="pp-stat-val green">{fmtNum(liveJoints)}</span>
              <span className="pp-stat-lbl">Current Joints</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-val">{fmtNum(production.total_joints_earned)}</span>
              <span className="pp-stat-lbl">Total Earned</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-val green">{fmtRate(production.joints_per_sec)}</span>
              <span className="pp-stat-lbl">Production Rate</span>
            </div>
          </div>
        </div>
      )}

      {/* Rank */}
      {production && (
        <div className="pp-card pp-rank-card">
          <div className="pp-rank-row">
            <Trophy size={24} className={rankIcon ? `rank-${rankIcon}` : 'pp-rank-icon'} />
            <div className="pp-rank-info">
              <span className="pp-rank-num">#{production.rank}</span>
              <span className="pp-rank-of">of {production.total_players} players</span>
            </div>
          </div>
        </div>
      )}

      {/* Stations */}
      {stations && (
        <div className="pp-card">
          <h2 className="pp-card-title"><Factory size={16} /> Stations</h2>
          <div className="pp-stations">
            {stations.plantations.map((p, i) => (
              <div key={i} className="pp-station-row">
                <span className="pp-station-icon">{p.icon || '🌱'}</span>
                <span className="pp-station-name">{p.name}</span>
                <span className="pp-station-level">Lv {p.level}</span>
                {p.has_manager && <Shield size={12} className="pp-mgr-badge" />}
              </div>
            ))}
            {stations.courier && (
              <div className="pp-station-row">
                <Truck size={14} className="pp-station-truck" />
                <span className="pp-station-name">Courier</span>
                <span className="pp-station-level">Cap {stations.courier.capacity} / Spd {stations.courier.speed_level}</span>
                {stations.courier.has_manager && <Shield size={12} className="pp-mgr-badge" />}
              </div>
            )}
            {stations.fabrik && (
              <div className="pp-station-row">
                <Factory size={14} className="pp-station-factory" />
                <span className="pp-station-name">Factory</span>
                <span className="pp-station-level">Cap {stations.fabrik.capacity} / Spd {stations.fabrik.speed_level}</span>
                {stations.fabrik.has_manager && <Shield size={12} className="pp-mgr-badge" />}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lottery */}
      {lottery && (
        <div className="pp-card">
          <h2 className="pp-card-title"><Ticket size={16} /> Lottery</h2>
          <div className="pp-stats-grid">
            <div className="pp-stat">
              <span className="pp-stat-val gold">{lottery.total_sats_won.toLocaleString()}</span>
              <span className="pp-stat-lbl">Sats Won</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-val">{lottery.total_tickets_purchased}</span>
              <span className="pp-stat-lbl">Tickets Bought</span>
            </div>
            <div className="pp-stat">
              <span className="pp-stat-val">{lottery.wins.length}</span>
              <span className="pp-stat-lbl">Wins</span>
            </div>
          </div>
          {lottery.wins.length > 0 && (
            <div className="pp-wins-list">
              <h3 className="pp-wins-title">Recent Wins</h3>
              {lottery.wins.map((w, i) => (
                <div key={i} className="pp-win-row">
                  <span className="pp-win-round">Round #{w.round_id}</span>
                  <span className="pp-win-amount">
                    <Zap size={12} /> {w.amount_sats.toLocaleString()} sats
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="pp-cta">
        <button className="info-play-btn" onClick={() => navigate('/')}>
          Play Joint Factory
        </button>
      </div>
    </div>
  );
}
