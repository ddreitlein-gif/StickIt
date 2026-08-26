import { useState, useEffect } from 'react'
import api from '../../utils/api'

/**
 * v2.0.00 (Step 1, R8) — Venue Adoption admin page.
 * Lists meets with adoption/release state and provides the force-unlock
 * recovery action for abandoned adoptions (system_admin only; typed
 * meet-name confirmation; audit-logged; invalidates the venue's sync token).
 */
export default function AdminAdoption() {
  const [meets, setMeets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(null) // meet being confirmed
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.adminAdoptionList()
    .then(d => setMeets(d.meets || []))
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const doForceUnlock = async () => {
    if (!unlocking) return
    setBusy(true)
    setError('')
    try {
      await api.adminForceUnlock(unlocking.id, confirmName)
      setUnlocking(null)
      setConfirmName('')
      await load()
    } catch (e) {
      setError(e.code === 'confirm_name_mismatch' ? 'The typed name does not match the meet name exactly.' : e.message)
    } finally { setBusy(false) }
  }

  const statusBadge = (m) => {
    if (m.adoption_status === 'adopted') return <span className="px-2 py-0.5 rounded text-xs bg-amber-900/50 text-amber-300 border border-amber-800">Adopted (venue)</span>
    if (m.adoption_status === 'checked_in') return <span className="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400 border border-green-800">Checked in</span>
    if (m.released) return <span className="px-2 py-0.5 rounded text-xs bg-mountain-900/50 text-mountain-300 border border-mountain-800">Released (code pending)</span>
    if (m.remote_judging) return <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">Remote judging (cloud-only)</span>
    return <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-500 border border-slate-700">—</span>
  }

  if (loading) return <div className="p-8 text-slate-500">Loading...</div>

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-3xl text-white mb-2">Venue Adoption</h1>
      <p className="text-slate-500 text-sm mb-6">
        Meets released for, adopted by, or checked in from a venue server. Force Unlock is the
        recovery path for an abandoned adoption (venue server lost or destroyed): it revokes the
        venue's sync token and returns cloud control. Cloud data is as of the last successful sync —
        recover anything newer from the venue's USB snapshot.
      </p>

      {error && <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-900/30 text-red-300 text-sm">{error}</div>}

      {meets.length === 0 ? (
        <div className="card text-center py-12 text-slate-500">No meets have venue adoption activity.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-4">Meet</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">State</th>
                <th className="py-2 pr-4">Adopted at</th>
                <th className="py-2 pr-4">Last sync</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {meets.map(m => (
                <tr key={m.id} className="border-b border-slate-800/50">
                  <td className="py-2 pr-4 text-slate-200">{m.name}</td>
                  <td className="py-2 pr-4 text-slate-500">{m.date}</td>
                  <td className="py-2 pr-4">{statusBadge(m)}</td>
                  <td className="py-2 pr-4 text-slate-500">{m.adopted_at || '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{m.last_sync_at || '—'}</td>
                  <td className="py-2 text-right">
                    {m.adoption_status === 'adopted' && (
                      <button
                        onClick={() => { setUnlocking(m); setConfirmName(''); setError('') }}
                        className="text-xs px-3 py-1.5 rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                      >
                        Force Unlock…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unlocking && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-red-900 rounded-2xl p-6 w-full max-w-lg">
            <h2 className="font-display text-2xl text-red-400 mb-3">Force Unlock — {unlocking.name}</h2>
            <div className="text-sm text-slate-400 space-y-2 mb-4">
              <p>This severs the venue server's connection permanently:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>The venue's sync token is revoked — its further score submissions will be <b>rejected</b>, not merged.</li>
                <li>Cloud data stays as of the last successful sync{unlocking.last_sync_at ? ` (${unlocking.last_sync_at})` : ''}.</li>
                <li>The venue's local data remains intact for manual USB recovery.</li>
              </ul>
              <p>Only use this when the venue server is lost, destroyed, or unreachable for good. If the venue is still running, use Hand Back or Check In from the venue instead.</p>
            </div>
            <label className="label">Type the meet name exactly to confirm</label>
            <input
              className="input mb-4"
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              placeholder={unlocking.name}
            />
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setUnlocking(null); setError('') }} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={doForceUnlock}
                disabled={busy || confirmName.trim() !== unlocking.name.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-red-700 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-600"
              >
                {busy ? 'Unlocking…' : 'Force Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
