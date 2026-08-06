import { useEffect, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { subscribeMaster, claimMaster, isMaster } from '../../lib/session'
import './TakeoverBar.css'

/**
 * Shown on the client that lost the account to a newer one.
 *
 * The alternative was to log the older client out, which is unambiguous but
 * makes moving between two machines a login every time. Taking over is the same
 * act as opening the page — whoever asked last owns it — so it is one button,
 * and the reload afterwards is what guarantees the chain it resumes is the one
 * the server actually holds.
 */
export default function TakeoverBar() {
  const [lost, setLost] = useState(!isMaster())
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeMaster(m => setLost(!m)), [])

  if (!lost) return null

  return (
    <div className="tob" role="status">
      <MonitorSmartphone size={16} className="tob-icon" />
      <span className="tob-text">
        Joint Factory is running in another window. Your chain is paused here.
      </span>
      <button
        className="tob-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          if (await claimMaster()) window.location.reload()
          else setBusy(false)
        }}
      >
        {busy ? 'Taking over…' : 'Continue here'}
      </button>
    </div>
  )
}
