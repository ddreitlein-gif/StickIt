import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../utils/api'
import { clearRoleMemory } from './venueShared'

/**
 * v2.0.00 (Step 3, FR-15) — auto-follow role wrapper.
 *
 * The tablet's URL is a stable venue role page (/venue/role/judge?seat=J2,
 * /venue/role/hj, /venue/role/timekeeper, /venue/role/scoreboard). The page
 * embeds the EXISTING role page for the active event in an iframe and swaps it
 * automatically as interleaved runs alternate — the role pages themselves are
 * untouched and no device ever needs its URL changed mid-day.
 *
 * FR-10: when the meet enters check-in, every role page freezes with a clear
 * "checking in / checked in — stop" screen so a volunteer cannot keep scoring
 * into a dead end.
 */
export default function VenueRole() {
  const { role } = useParams()
  const [searchParams] = useSearchParams()
  const seat = searchParams.get('seat') || undefined
  const navigate = useNavigate()
  const [target, setTarget] = useState(null)
  const [err, setErr] = useState('')
  const urlRef = useRef(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const t = await api.venueRoleTarget(role, seat)
        if (!alive) return
        setErr('')
        setTarget(prev => {
          // Only remount the iframe when the target URL actually changes.
          if (prev && prev.url === t.url && prev.meet_state === t.meet_state && prev.error === t.error) return prev
          return t
        })
      } catch (e) { if (alive) setErr(e.message) }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [role, seat])

  const exit = async () => {
    clearRoleMemory()
    if (role === 'judge' && seat) { try { await api.venueReleaseSeat(seat) } catch (_) {} }
    navigate('/?menu=1')
  }

  const frozen = target && (target.meet_state === 'checking_in' || target.meet_state === 'checked_in' || target.meet_state === 'handed_back')

  if (frozen) {
    const done = target.meet_state !== 'checking_in'
    // L-6: handed_back gets its own copy — on night 1 of a two-day meet,
    // "checked in … power tablets down" would be wrong and confusing.
    const handedBack = target.meet_state === 'handed_back'
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <div className="text-6xl mb-6">{done ? (handedBack ? '🌙' : '✅') : '⏳'}</div>
        <h1 className="font-display text-4xl mb-3">
          {done
            ? (handedBack ? 'Handed back for tonight — you can stop' : 'Meet checked in — you can stop')
            : 'Meet is checking in…'}
        </h1>
        <p className="text-slate-400 max-w-md">
          {done
            ? (handedBack
              ? 'Today\'s results are safely on stickitski.com and tonight\'s work (brackets, run orders) happens there. Scoring is done here for today — in the morning the meet is adopted again with a NEW release code.'
              : 'All results are safely on stickitski.com. Scoring is closed on this server — thank you for your work today. You can power tablets down.')
            : 'The Scoring Computer is sending final results to the cloud. Please stop scoring — this screen will update when it finishes.'}
        </p>
        <button onClick={exit} className="mt-8 text-sm text-slate-600 underline">Back to menu</button>
      </div>
    )
  }

  if (target && target.error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
        <h1 className="font-display text-3xl mb-3">Waiting…</h1>
        <p className="text-slate-400 max-w-md">{target.message || target.error}</p>
        <button onClick={exit} className="mt-8 text-sm text-slate-600 underline">Back to menu</button>
      </div>
    )
  }

  if (!target) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">{err || 'Connecting…'}</div>
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#020617' }}>
      <iframe
        key={target.url}
        src={target.url}
        title={`venue-${role}`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        allow="fullscreen"
      />
      {/* Small, deliberate exit affordance — bottom-left, low prominence */}
      <button
        onClick={exit}
        title="Back to venue menu"
        style={{
          position: 'fixed', left: 6, bottom: 6, zIndex: 50,
          background: 'rgba(15,23,42,0.7)', color: '#64748b',
          border: '1px solid #1e293b', borderRadius: 8,
          fontSize: 11, padding: '4px 8px',
        }}
      >
        ⌂ menu
      </button>
    </div>
  )
}
