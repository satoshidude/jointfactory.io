import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ArrowDownToLine, ArrowUpFromLine, Trophy, UserPlus, Wallet, TrendingUp, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';
import './Wallet.css';

interface Payment {
  type: 'deposit' | 'lottery_win' | 'ticket' | 'withdraw' | 'referral_reward';
  amount_sats: number;
  ts: number;
  ref: string | number;
}

type Tab = 'deposits' | 'won' | 'withdrawn';

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function WalletPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sats, setSats] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('won');

  useEffect(() => {
    apiFetch('/player/payments')
      .then((d: any) => {
        if (d.ok) {
          setPayments(d.payments || []);
          setSats(d.sats || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deposits = payments.filter(p => p.type === 'deposit');
  const won = payments.filter(p => p.type === 'lottery_win' || p.type === 'referral_reward');
  const withdrawn = payments.filter(p => p.type === 'withdraw');

  const totalDeposited = deposits.reduce((s, p) => s + p.amount_sats, 0);
  const totalWon = won.reduce((s, p) => s + p.amount_sats, 0);
  const totalWithdrawn = withdrawn.reduce((s, p) => s + p.amount_sats, 0);

  const tabItems: Payment[] = tab === 'deposits' ? deposits : tab === 'won' ? won : withdrawn;
  const isNegative = tab === 'withdrawn';

  if (!auth.isLoggedIn) {
    return (
      <div className="wallet-page">
        <div className="wallet-hero">
          <div className="wallet-hero-glow" />
          <div className="wallet-hero-icon-wrap">
            <div className="wallet-hero-icon">
              <Wallet size={48} />
            </div>
          </div>
          <h1 className="wallet-hero-title">Sats Account</h1>
          <p className="wallet-hero-subtitle">
            Sign in to view your sats balance, deposits, wins and withdrawals!
          </p>
          <div className="wallet-hero-perks">
            <div className="wallet-perk">
              <ArrowDownToLine size={20} />
              <span>Deposit sats</span>
            </div>
            <div className="wallet-perk gold">
              <Trophy size={20} />
              <span>Win in lottery</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-page">
      <button className="info-back" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Back to Game
      </button>
      {/* Hero */}
      <div className="wallet-hero">
        <div className="wallet-hero-glow" />
        <div className="wallet-hero-icon-wrap">
          <div className="wallet-hero-icon">
            <Zap size={48} />
          </div>
        </div>
        <h1 className="wallet-hero-title">Sats Account</h1>
        <p className="wallet-hero-subtitle">
          Your lightning wallet for the Joint Factory
        </p>
      </div>

      {/* Balance card */}
      <div className="wallet-balance-card">
        <div className="wallet-balance-label">Current Balance</div>
        <div className="wallet-balance-value">
          <Zap size={24} />
          <span>{Math.floor(sats).toLocaleString()}</span>
          <span className="wallet-balance-unit">sats</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="wallet-stats-row">
        <div className="wallet-stat-card">
          <ArrowDownToLine size={18} />
          <span className="wallet-stat-val green">+{totalDeposited.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Deposited</span>
        </div>
        <div className="wallet-stat-card">
          <TrendingUp size={18} />
          <span className="wallet-stat-val gold">+{totalWon.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Won</span>
        </div>
        <div className="wallet-stat-card">
          <ArrowUpFromLine size={18} />
          <span className="wallet-stat-val pink">-{totalWithdrawn.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Withdrawn</span>
        </div>
      </div>

      {/* Tabs + History */}
      <div className="wallet-history-card">
        <div className="wallet-tabs">
          <button className={`wallet-tab${tab === 'deposits' ? ' active' : ''}`} onClick={() => setTab('deposits')}>
            <ArrowDownToLine size={14} />
            <span>Deposits</span>
            <span className="wallet-tab-count">{deposits.length}</span>
          </button>
          <button className={`wallet-tab${tab === 'won' ? ' active' : ''}`} onClick={() => setTab('won')}>
            <Trophy size={14} />
            <span>Won</span>
            <span className="wallet-tab-count">{won.length}</span>
          </button>
          <button className={`wallet-tab${tab === 'withdrawn' ? ' active' : ''}`} onClick={() => setTab('withdrawn')}>
            <ArrowUpFromLine size={14} />
            <span>Withdrawn</span>
            <span className="wallet-tab-count">{withdrawn.length}</span>
          </button>
        </div>

        {loading ? (
          <div className="wallet-loading">Loading...</div>
        ) : tabItems.length === 0 ? (
          <div className="wallet-empty">No {tab === 'deposits' ? 'deposits' : tab === 'won' ? 'wins' : 'withdrawals'} yet</div>
        ) : (
          <div className="wallet-tx-list">
            {tabItems.map((p, i) => (
              <div key={i} className={`wallet-tx wallet-tx-${p.type}`}>
                <div className="wallet-tx-icon">
                  {p.type === 'deposit' && <ArrowDownToLine size={16} />}
                  {p.type === 'lottery_win' && <Trophy size={16} />}
                  {p.type === 'referral_reward' && <UserPlus size={16} />}
                  {p.type === 'withdraw' && <ArrowUpFromLine size={16} />}
                </div>
                <div className="wallet-tx-info">
                  <span className="wallet-tx-type">
                    {p.type === 'deposit' && 'Deposit'}
                    {p.type === 'lottery_win' && 'Lottery Win'}
                    {p.type === 'referral_reward' && `Referral: ${p.ref || 'Buddy'}`}
                    {p.type === 'withdraw' && 'Withdrawal'}
                  </span>
                  <span className="wallet-tx-time">{timeAgo(p.ts)}</span>
                </div>
                <span className={`wallet-tx-amount ${isNegative ? 'negative' : 'positive'}`}>
                  {isNegative ? '-' : '+'}{p.amount_sats.toLocaleString()} sats
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
