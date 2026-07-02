import { useState, useEffect } from 'react'
import { authHeaders } from '../utils/api'

// v1.27.00 — fully-automatic USSS transmit from the meet page More menu.
// One zip with an XML per event; category / USSS codes / TD info all derive
// from stored data server-side. Body carries only { acknowledgeWarnings }.

const DISCIPLINE_LABELS = { mogul: 'Mogul', dual_mogul: 'Dual Mogul', aerials: 'Aerials' }
const GENDER_LABELS = { male: 'Men', female: 'Women', M: 'Men', F: 'Women' }

export default function UsssTransmitModal({ meetId, onClose }) {
  const [check, setCheck] = useState(null)
  const [checkError, setCheckError] = useState(null)
  const [errors, setErrors] = useState([])
  const [warnings, setWarnings] = useState([])
  const [needsAck, setNeedsAck] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [doneFile, setDoneFile] = useState(null)

  useEffect(() => {
    fetch(`/api/export/usss-transmit-check/${meetId}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => { if (data.error) setCheckError(data.error); else setCheck(data) })
      .catch(e => setCheckError(e.message))
  }, [meetId])

  const doGenerate = async (acknowledgeWarnings = false) => {
    setErrors([]); setWarnings([]); setNeedsAck(false); setGenerating(true)
    try {
      const res = await fetch(`/api/export/usss-transmit/${meetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acknowledgeWarnings }),
      })

      if (res.status === 400) {
        const data = await res.json()
        setErrors(data.errors || [])
        setWarnings(data.warnings || [])
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed (${res.status})`)
      }

      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const data = await res.json()
        if (data.needsAcknowledgment) {
          setWarnings(data.warnings || [])
          setNeedsAck(true)
          return
        }
      }

      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match ? match[1] : 'USSS_Transmit.ZIP'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setDoneFile(filename)
    } catch (e) {
      setErrors([e.message])
    } finally {
      setGenerating(false)
    }
  }

  const events = check?.events || []
  const td = check?.td

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl text-white">USSS Transmit</h2>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
          </div>

          {doneFile ? (
            <div className="text-center py-6">
              <div className="text-green-400 text-5xl mb-4">✓</div>
              <div className="text-white text-lg font-semibold mb-2">Transmit file downloaded</div>
              <div className="text-slate-400 text-sm font-mono mb-6">{doneFile}</div>
              <div className="bg-mountain-900/40 border border-mountain-700 rounded-lg p-4 text-mountain-200 text-base font-semibold">
                Please email file to results@ussa.org
              </div>
              <div className="mt-6 flex justify-center">
                <button onClick={onClose} className="btn-primary">Close</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-slate-400 text-sm mb-4">
                Generates one zip with a USSS results XML file for every event in this meet.
                All events must be complete and have a USSS code before the file can be created.
              </p>

              {checkError && (
                <div className="bg-red-900/30 border border-red-800 rounded p-3 text-red-300 text-sm mb-4">{checkError}</div>
              )}

              {!check && !checkError && <p className="text-slate-400 text-sm">Checking events…</p>}

              {check && (
                <div className="space-y-2 mb-4">
                  {events.length === 0 && (
                    <div className="bg-red-900/30 border border-red-800 rounded p-3 text-red-300 text-sm">
                      This meet has no events.
                    </div>
                  )}
                  {events.map(ev => (
                    <div key={ev.id} className="bg-slate-800/50 border border-slate-700 rounded p-3 flex items-start gap-3">
                      <span className={`mt-0.5 text-lg leading-none ${ev.ready ? 'text-green-400' : 'text-red-400'}`}>
                        {ev.ready ? '✓' : '✗'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-white text-sm font-semibold">{ev.name}</div>
                        <div className="text-slate-500 text-xs">
                          {DISCIPLINE_LABELS[ev.discipline] || ev.discipline} · {GENDER_LABELS[ev.gender] || ev.gender}
                          {ev.ready && <> · Code {ev.usss_code} · {ev.category}</>}
                        </div>
                        {!ev.ready && (
                          <ul className="text-red-300 text-xs list-disc ml-4 mt-1 space-y-0.5">
                            {ev.problems.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                  {td?.required && (
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3 flex items-start gap-3">
                      <span className={`mt-0.5 text-lg leading-none ${td.problems.length === 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {td.problems.length === 0 ? '✓' : '✗'}
                      </span>
                      <div>
                        <div className="text-white text-sm font-semibold">Technical Delegate</div>
                        {td.problems.length === 0 ? (
                          <div className="text-slate-500 text-xs">{td.name} · USSS# {td.ussa_id}</div>
                        ) : (
                          <ul className="text-red-300 text-xs list-disc ml-4 mt-1 space-y-0.5">
                            {td.problems.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {errors.length > 0 && (
                <div className="bg-red-900/30 border border-red-800 rounded p-3 mb-4">
                  <div className="text-red-300 text-sm font-semibold mb-1">Cannot generate transmit file:</div>
                  <ul className="text-red-300 text-xs list-disc ml-4 space-y-0.5">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="bg-yellow-900/30 border border-yellow-800 rounded p-3 mb-4">
                  <div className="text-yellow-300 text-sm font-semibold mb-1">
                    Warnings{needsAck ? ' — you can proceed anyway:' : ':'}
                  </div>
                  <ul className="text-yellow-200 text-xs list-disc ml-4 space-y-0.5">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button onClick={onClose} disabled={generating} className="btn-secondary">Cancel</button>
                <button
                  onClick={() => doGenerate(needsAck)}
                  disabled={generating || !check || events.length === 0}
                  className="btn-primary"
                >
                  {generating ? 'Generating…' : needsAck ? 'Proceed with Warnings' : 'Generate Transmit File'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
