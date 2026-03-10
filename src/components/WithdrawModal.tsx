import { useState, useMemo } from 'react';
import { X, ArrowUpFromLine, Zap, Loader } from 'lucide-react';
import { useAuth } from '../stores/authStore';
import { apiFetch } from '../lib/api';
import { useGameDisplay } from '../stores/gameDisplayStore';
import './WithdrawModal.css';

const REQUIRED_MANAGERS = 3;

interface Props {
  onClose: () => void;
}

function countManagers(gs: any) {
  if (!gs) return 0;
  let count = 0;
  if (gs.plantagen?.[0]?.managerLevel > 0) count++;
  if (gs.courier?.mgrLevel > 0) count++;
  if (gs.fabrik?.mgrLevel > 0) count++;
  return count;
}

export default function WithdrawModal({ onClose }: Props) {
  const auth = useAuth();
  const { rawGameState } = useGameDisplay();

  const mgrs = useMemo(() => countManagers(rawGameState), [rawGameState]);
  const needed = REQUIRED_MANAGERS - mgrs;
  const ok = mgrs >= REQUIRED_MANAGERS;

  const [address, setAddress] = useState(auth.lightningAddress || '');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);

  async function handleWithdraw() {
    const amountSats = parseInt(amount);
    if (!address.includes('@')) {
      setError('Enter a valid Lightning Address (user@domain)');
      return;
    }
    if (!amountSats || amountSats < 1) {
      setError('Enter an amount to withdraw');
      return;
    }
    if (amountSats > auth.sats) {
      setError(`Not enough sats (${auth.sats} available)`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/game/withdraw', {
        method: 'POST',
        body: JSON.stringify({ lightning_address: address, amount_sats: amountSats }),
      });
      if (!res.ok) {
        setError(res.reason || 'Withdrawal failed');
        return;
      }
      setPaidAmount(res.paid);
      setSuccess(true);
      auth.setSats(auth.sats - amountSats);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  }

  function handleMax() {
    setAmount(String(auth.sats));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="withdraw-modal" onClick={e => e.stopPropagation()}>
        <div className="withdraw-header">
          <h2><ArrowUpFromLine size={18} /> Withdraw Sats</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="withdraw-body">
          {!success ? (
            <>
              <div className="withdraw-balance">
                <span>Available</span>
                <span className="withdraw-balance-value">
                  <Zap size={14} /> {auth.sats.toLocaleString()} sats
                </span>
              </div>

              <div className={`ws-progress-wrap${ok ? ' complete' : ''}`}>
                <div className="ws-progress-header">
                  <span className={`ws-progress-label${ok ? ' ready' : ''}`}>
                    {ok ? 'All managers hired' : `${needed} auto-manager${needed !== 1 ? 's' : ''} left to unlock withdraw`}
                  </span>
                  <span className="ws-progress-fraction">{mgrs}/{REQUIRED_MANAGERS}</span>
                </div>
                <div className="ws-progress-track">
                  {Array.from({ length: REQUIRED_MANAGERS }, (_, i) => (
                    <div key={i} className={`ws-progress-seg ${i < mgrs ? 'filled' : ''}`} />
                  ))}
                </div>
              </div>

              {ok && (
                <div className="ws-ready-banner">Ready to cash out!</div>
              )}

              <label className="withdraw-label">Lightning Address</label>
              <input
                className="withdraw-input"
                placeholder="user@wallet.com"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />

              <label className="withdraw-label">Amount (sats)</label>
              <div className="withdraw-amount-row">
                <input
                  className="withdraw-input"
                  type="number"
                  placeholder="1"
                  min="1"
                  max={auth.sats}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleWithdraw()}
                />
                <button className="withdraw-max" onClick={handleMax}>MAX</button>
              </div>

              <button className="withdraw-action" onClick={handleWithdraw} disabled={loading || !ok}>
                {loading ? (
                  <><Loader size={16} className="spin" /> Sending...</>
                ) : (
                  <><ArrowUpFromLine size={16} /> Withdraw</>
                )}
              </button>

              {error && <p className="withdraw-error">{error}</p>}
            </>
          ) : (
            <div className="withdraw-success">
              <Zap size={32} className="success-icon" />
              <h3>{paidAmount.toLocaleString()} sats sent!</h3>
              <p>Payment sent to {address}</p>
              <button className="deposit-done" onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
