import { useState } from 'react'
import api from '../utils/api'

/**
 * v2.5.00 — import a venue RETURN file on the cloud (offline check-in /
 * handback). Shows what the venue recorded, lets the importer change the
 * action (David's ruling: show it, allow change), and explains every refusal
 * by its machine code. Used from the meet page (expectedMeetId set) and from
 * Admin → Venue Adoption (routes by the file's own meet id).
 *
 * props: { pkg, expectedMeetId?, onDone(result), onClose }
 */
const MODE_LABEL = { checkin: 'Check In (final)', handback: 'Hand Back (overnight)' }

function fmt(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString() } catch { return String(ts) }
}

function errorCopy(e) {
  switch (e.code) {
    case 'stale_return_file':
      return 'This file was written under an EARLIER adoption of the meet — the meet has since been adopted again (by code, or by a newer file). Only the venue that currently holds it can return it. Nothing was changed.'
    case 'file_corrupt':
      return `The file failed its own integrity check${e.body?.tables ? ` (${e.body.tables.join(', ')})` : ''}. It may be truncated or edited — download it from the venue server again. Nothing was changed.`
    case 'checksum_mismatch':
      return `The import ran but verification still differs (${(e.body?.mismatched || []).join(', ')}). The meet stays locked; nothing was lost. Try again, or call support.`
    case 'already_returned':
      return 'This meet was already checked in — the return file has been imported before. Nothing to do.'
    case 'not_adopted':
      return 'This meet is not adopted on the cloud any more (the lock was undone or force-unlocked, or a handback file was already imported). The file is refused because the cloud copy may have changed since.'
    case 'wrong_meet':
      return `This file belongs to a different meet${e.body?.file_meet_name ? ` ("${e.body.file_meet_name}")` : ''}. Open that meet and import it there.`
    case 'protocol_mismatch':
      return 'The venue server and the cloud run different sync protocol versions. Update StickIt on the older side, then write the return file again.'
    case 'bad_package':
      return 'This is not a StickIt return file. Use the "Return file" downloaded from the venue server, not an adoption file or a meet export.'
    default:
      return e.message || 'Import failed.'
  }
}

export default function ReturnImportDialog({ pkg, expectedMeetId, onDone, onClose }) {
  const recorded = pkg?.mode === 'handback' ? 'handback' : 'checkin'
  const [mode, setMode] = useState(recorded)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const wrongMeet = !!expectedMeetId && pkg?.meet_id !== expectedMeetId
  const runs = Array.isArray(pkg?.tables?.runs) ? pkg.tables.runs.length : null
  const scores = Array.isArray(pkg?.tables?.judge_scores) ? pkg.tables.judge_scores.length : null
  const events = Array.isArray(pkg?.tables?.events) ? pkg.tables.events.length : null

  const doImport = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api.importReturnFile(pkg.meet_id, pkg, mode)
      setResult(r)
      if (onDone) onDone(r)
    } catch (e) {
      setErr(errorCopy(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="return-import-dialog">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg">
        <h2 className="font-display text-2xl text-white mb-1">Import Venue Return File</h2>
        <p className="text-slate-500 text-sm mb-4">
          The venue server wrote this file when the internet was down. Importing it brings every score
          from the venue into the cloud copy and verifies the result — the same check as an online return.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm space-y-1 mb-4">
          <div className="flex justify-between gap-4"><span className="text-slate-500">Meet</span><span className="text-slate-200 text-right">{pkg?.meet_name || pkg?.meet_id}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Written at the venue</span><span className="text-slate-200">{fmt(pkg?.exported_at)}</span></div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Venue chose</span>
            <span className={`px-2 py-0.5 rounded text-xs border ${recorded === 'checkin' ? 'bg-green-900/40 text-green-300 border-green-800' : 'bg-mountain-900/40 text-mountain-300 border-mountain-800'}`}>
              {MODE_LABEL[recorded]}
            </span>
          </div>
          {(events != null || runs != null) && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Contents</span>
              <span className="text-slate-300">
                {events != null ? `${events} event${events === 1 ? '' : 's'}` : ''}
                {runs != null ? ` · ${runs} run${runs === 1 ? '' : 's'}` : ''}
                {scores != null ? ` · ${scores} judge score${scores === 1 ? '' : 's'}` : ''}
              </span>
            </div>
          )}
        </div>

        {wrongMeet && (
          <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-900/30 text-red-300 text-sm">
            This file is for a different meet ({pkg?.meet_name || pkg?.meet_id}). Open that meet's page — or use
            Admin → Venue Adoption, which imports any meet's return file.
          </div>
        )}

        {!result && (
          <>
            <div className="label mb-1">Apply as</div>
            <div className="flex gap-3 mb-2">
              {['checkin', 'handback'].map(m => (
                <label key={m} className={`flex-1 cursor-pointer rounded-lg border p-3 text-sm ${mode === m ? 'border-mountain-500 bg-mountain-900/30 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                  <input type="radio" className="mr-2" name="return-mode" value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`return-mode-${m}`} />
                  {MODE_LABEL[m]}
                  <div className="text-xs text-slate-500 mt-1 ml-5">
                    {m === 'checkin'
                      ? 'The meet is finished — results become the permanent cloud record.'
                      : 'Two-day meet — the cloud unlocks tonight for bracket work; the venue adopts again tomorrow.'}
                  </div>
                </label>
              ))}
            </div>
            {mode !== recorded && (
              <div className="mb-3 p-2 rounded border border-amber-800 bg-amber-900/20 text-amber-300 text-xs">
                You are changing what the venue chose ({MODE_LABEL[recorded]}). The imported data is identical either way — only the resulting cloud state differs.
              </div>
            )}
          </>
        )}

        {err && <div className="mb-3 p-3 rounded-lg border border-red-800 bg-red-900/30 text-red-300 text-sm">{err}</div>}

        {result ? (
          <div className="mb-4 p-3 rounded-lg border border-green-800 bg-green-900/20 text-green-300 text-sm" data-testid="return-import-done">
            ✓ Imported and verified ({result.verified_tables} tables). The meet is now
            {result.mode === 'checkin' ? ' checked in — the permanent cloud record.' : ' handed back — the cloud copy is editable again.'}
          </div>
        ) : null}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button onClick={doImport} disabled={busy || wrongMeet} className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed" data-testid="return-import-confirm">
              {busy ? 'Importing…' : `Import as ${mode === 'checkin' ? 'Check In' : 'Hand Back'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
