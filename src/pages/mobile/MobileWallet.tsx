import { useState, useEffect } from 'react'
import { Zap, ArrowDownToLine, ArrowUpFromLine, Trophy, UserPlus, Wallet, TrendingUp } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import DepositModal from '../../components/DepositModal'
import WithdrawModal from '../../components/WithdrawModal'
import LoginModal from '../../components/LoginModal'
import '../Wallet.css'
import './MobilePages.css'

interface Payment {
  type: 'deposit' | 'lottery_win' | 'ticket' | 'withdraw' | 'referral_reward'
  amount_sats: number
  ts: number
  ref: string | number
}

type Tab = 'deposits' | 'won' | 'withdrawn'

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function MobileWallet() {
  const auth = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [sats, setSats] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('won')
  const [showDeposit, setShowDeposit] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  const reload = () => {
    apiFetch('/player/payments')
      .then((d: any) => {
        if (d.ok) {
          setPayments(d.payments || [])
          setSats(d.sats || 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (auth.isLoggedIn) reload()
    else setLoading(false)
  }, [auth.isLoggedIn])

  const deposits = payments.filter(p => p.type === 'deposit')
  const won = payments.filter(p => p.type === 'lottery_win' || p.type === 'referral_reward')
  const withdrawn = payments.filter(p => p.type === 'withdraw')

  const totalDeposited = deposits.reduce((s, p) => s + p.amount_sats, 0)
  const totalWon = won.reduce((s, p) => s + p.amount_sats, 0)
  const totalWithdrawn = withdrawn.reduce((s, p) => s + p.amount_sats, 0)

  const tabItems: Payment[] = tab === 'deposits' ? deposits : tab === 'won' ? won : withdrawn
  const isNegative = tab === 'withdrawn'

  if (!auth.isLoggedIn) {
    return (
      <div className="mobile-page mobile-wallet">
        <div className="wallet-hero">
          <div className="wallet-hero-glow" />
          <div className="wallet-hero-icon-wrap">
            <div className="wallet-hero-icon">
              <Wallet size={48} />
            </div>
          </div>
          <h1 className="wallet-hero-title">Sats Account</h1>
          <p className="wallet-hero-subtitle">
            Sign in to view your sats balance, deposits, wins and withdrawals.
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
          <button className="mobile-wallet-login-btn" onClick={() => setShowLogin(true)}>
            Sign in
          </button>
        </div>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </div>
    )
  }

  return (
    <div className="mobile-page mobile-wallet">
      {/* Balance card */}
      <div className="wallet-balance-card">
        <div className="wallet-balance-label">Current Balance</div>
        <div className="wallet-balance-value">
          <Zap size={24} />
          <span>{Math.floor(sats).toLocaleString()}</span>
          <span className="wallet-balance-unit">sats</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="wallet-action-row">
        <button className="wallet-action-btn deposit" onClick={() => setShowDeposit(true)}>
          <ArrowDownToLine size={18} />
          <span>Deposit</span>
        </button>
        <button className="wallet-action-btn withdraw" onClick={() => setShowWithdraw(true)}>
          <ArrowUpFromLine size={18} />
          <span>Withdraw</span>
        </button>
      </div>

      {/* Stats tabs */}
      <div className="wallet-stats-row">
        <button className={`wallet-stat-card${tab === 'deposits' ? ' active' : ''}`} onClick={() => setTab('deposits')}>
          <ArrowDownToLine size={18} />
          <span className="wallet-stat-val green">+{totalDeposited.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Deposited <span className="wallet-stat-count">{deposits.length}</span></span>
        </button>
        <button className={`wallet-stat-card${tab === 'won' ? ' active' : ''}`} onClick={() => setTab('won')}>
          <TrendingUp size={18} />
          <span className="wallet-stat-val gold">+{totalWon.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Won <span className="wallet-stat-count">{won.length}</span></span>
        </button>
        <button className={`wallet-stat-card${tab === 'withdrawn' ? ' active' : ''}`} onClick={() => setTab('withdrawn')}>
          <ArrowUpFromLine size={18} />
          <span className="wallet-stat-val pink">-{totalWithdrawn.toLocaleString()}</span>
          <span className="wallet-stat-lbl">Withdrawn <span className="wallet-stat-count">{withdrawn.length}</span></span>
        </button>
      </div>

      {/* Transaction history */}
      <div className="wallet-history-card">
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

      {showDeposit && <DepositModal onClose={() => { setShowDeposit(false); reload() }} />}
      {showWithdraw && <WithdrawModal onClose={() => { setShowWithdraw(false); reload() }} />}
    </div>
  )
}
