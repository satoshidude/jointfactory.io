import { useState, useEffect } from 'react';
import { X, Zap, ArrowDownToLine, ArrowUpFromLine, Trophy, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import './SatsModal.css';

interface Payment {
  type: 'deposit' | 'lottery_win' | 'ticket' | 'withdraw' | 'referral_reward';
  amount_sats: number;
  ts: number;
  ref: string | number;
}

interface Props {
  onClose: () => void;
}

type Tab = 'deposits' | 'won' | 'withdrawn';

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SatsModal({ onClose }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sats, setSats] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('deposits');

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sats-modal" onClick={e => e.stopPropagation()}>
        <div className="sats-modal-header">
          <h2><Zap size={20} /> Sats Account</h2>
          <button className="sats-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sats-modal-body">
          <div className="sats-balance-row">
            <span className="sats-balance-label">Balance</span>
            <span className="sats-balance-value">{Math.floor(sats).toLocaleString()} sats</span>
          </div>
          <div className="sats-tabs">
            <button className={`sats-tab${tab === 'deposits' ? ' active' : ''}`} onClick={() => setTab('deposits')}>
              <ArrowDownToLine size={13} />
              <span>Deposited</span>
              <span className="sats-tab-total">+{totalDeposited.toLocaleString()}</span>
            </button>
            <button className={`sats-tab${tab === 'won' ? ' active' : ''}`} onClick={() => setTab('won')}>
              <Trophy size={13} />
              <span>Won</span>
              <span className="sats-tab-total">+{totalWon.toLocaleString()}</span>
            </button>
            <button className={`sats-tab${tab === 'withdrawn' ? ' active' : ''}`} onClick={() => setTab('withdrawn')}>
              <ArrowUpFromLine size={13} />
              <span>Withdrawn</span>
              <span className="sats-tab-total">-{totalWithdrawn.toLocaleString()}</span>
            </button>
          </div>
          <div className="sats-history">
            {loading ? (
              <div className="sats-loading">Loading...</div>
            ) : tabItems.length === 0 ? (
              <div className="sats-empty">No {tab === 'deposits' ? 'deposits' : tab === 'won' ? 'wins' : 'withdrawals'} yet</div>
            ) : (
              tabItems.map((p, i) => (
                <div className={`sats-tx sats-tx-${p.type}`} key={i}>
                  <div className="sats-tx-icon">
                    {p.type === 'deposit' && <ArrowDownToLine size={14} />}
                    {p.type === 'lottery_win' && <Trophy size={14} />}
                    {p.type === 'referral_reward' && <UserPlus size={14} />}
                    {p.type === 'withdraw' && <ArrowUpFromLine size={14} />}
                  </div>
                  <div className="sats-tx-info">
                    <span className="sats-tx-type">
                      {p.type === 'deposit' && 'Deposit'}
                      {p.type === 'lottery_win' && 'Lottery Win'}
                      {p.type === 'referral_reward' && `Referral: ${p.ref || 'Buddy'}`}
                      {p.type === 'withdraw' && 'Withdraw'}
                    </span>
                    <span className="sats-tx-time">{timeAgo(p.ts)}</span>
                  </div>
                  <span className={`sats-tx-amount ${isNegative ? 'negative' : 'positive'}`}>
                    {isNegative ? '-' : '+'}{p.amount_sats.toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
