import { useState, useEffect, useRef } from 'react';
import { X, Zap, ArrowDownToLine, Check, Copy, Loader, Wallet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../stores/authStore';
import { apiFetch } from '../lib/api';
import './DepositModal.css';

declare global {
  interface Window {
    webln?: {
      enable(): Promise<void>;
      sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
    };
  }
}

interface Pack {
  id: string;
  sats: number;
  price_sats: number;
  label: string;
  description: string;
}

interface Props {
  onClose: () => void;
}

const PENDING_KEY = 'jf_pending_payment';

function savePending(hash: string, bolt11: string) {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ hash, bolt11, ts: Date.now() }));
}
function loadPending(): { hash: string; bolt11: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - p.ts > 15 * 60 * 1000) { localStorage.removeItem(PENDING_KEY); return null; }
    return p;
  } catch { return null; }
}
function clearPending() { localStorage.removeItem(PENDING_KEY); }

export default function DepositModal({ onClose }: Props) {
  const auth = useAuth();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ bolt11: string; payment_hash: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payingWithAlby, setPayingWithAlby] = useState(false);
  const [hasWebLN, setHasWebLN] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling(hash: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const status = await apiFetch(`/lightning/status/${hash}`);
      if (status.paid) {
        setPaid(true);
        clearPending();
        if (pollRef.current) clearInterval(pollRef.current);
        const state = await apiFetch('/game/state');
        if (state?.sats !== undefined) auth.setSats(state.sats);
      }
    }, 2000);
  }

  // Load packs + resume pending payment + detect WebLN
  useEffect(() => {
    apiFetch('/lightning/packs').then(res => {
      if (res.packs) setPacks(res.packs);
    });
    setHasWebLN(!!window.webln);
    const pending = loadPending();
    if (pending) {
      setInvoice({ bolt11: pending.bolt11, payment_hash: pending.hash });
      startPolling(pending.hash);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBuy(packId: string) {
    setSelectedPack(packId);
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/lightning/invoice', {
        method: 'POST',
        body: JSON.stringify({ packId }),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setInvoice({ bolt11: res.bolt11, payment_hash: res.payment_hash });
      savePending(res.payment_hash, res.bolt11);
      startPolling(res.payment_hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create invoice');
    } finally {
      setLoading(false);
    }
  }

  async function handlePayWithAlby() {
    if (!invoice || !window.webln) return;
    setPayingWithAlby(true);
    setError('');
    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.bolt11);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('User rejected')) {
        setError('Alby: ' + msg);
      }
    } finally {
      setPayingWithAlby(false);
    }
  }

  function handleCopy() {
    if (!invoice) return;
    navigator.clipboard.writeText(invoice.bolt11);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="deposit-modal" onClick={e => e.stopPropagation()}>
        <div className="deposit-header">
          <h2><ArrowDownToLine size={18} /> Deposit Sats</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="deposit-body">
          {!invoice && !paid && (
            <>
              <p className="deposit-hint">Choose a pack to deposit sats via Lightning.</p>
              <div className="pack-grid">
                {packs.map(pack => (
                  <button
                    key={pack.id}
                    className={`pack-card ${selectedPack === pack.id ? 'selected' : ''}`}
                    onClick={() => handleBuy(pack.id)}
                    disabled={loading}
                  >
                    <span className="pack-label">{pack.label}</span>
                    <span className="pack-amount">{pack.price_sats} sats</span>
                  </button>
                ))}
              </div>
              {loading && (
                <div className="deposit-loading">
                  <Loader size={16} className="spin" /> Creating invoice...
                </div>
              )}
            </>
          )}

          {invoice && !paid && (
            <div className="invoice-view">
              {hasWebLN && (
                <button
                  className="alby-pay-btn"
                  onClick={handlePayWithAlby}
                  disabled={payingWithAlby}
                >
                  {payingWithAlby ? (
                    <><Loader size={16} className="spin" /> Paying...</>
                  ) : (
                    <><Wallet size={16} /> Pay with Alby</>
                  )}
                </button>
              )}

              <p className="deposit-hint">
                {hasWebLN ? 'Or scan / copy the invoice manually.' : 'Scan or copy the Lightning invoice to pay.'}
              </p>
              <div className="qr-wrapper">
                <QRCodeSVG
                  value={invoice.bolt11.toUpperCase()}
                  size={200}
                  bgColor="#161822"
                  fgColor="#22c55e"
                  level="M"
                />
              </div>
              <div className="bolt11-row">
                <input className="bolt11-input" value={invoice.bolt11} readOnly />
                <button className="bolt11-copy" onClick={handleCopy} title="Copy">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div className="deposit-loading">
                <Loader size={16} className="spin" /> Waiting for payment...
              </div>
            </div>
          )}

          {paid && (
            <div className="deposit-success">
              <Zap size={32} className="success-icon" />
              <h3>Payment received!</h3>
              <p>Your sats have been credited.</p>
              <button className="deposit-done" onClick={onClose}>Done</button>
            </div>
          )}

          {error && <p className="deposit-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
