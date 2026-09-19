import { useState, useMemo, useRef } from 'react'
import api from '../utils/api'

// v2.7.00 — unified registration import dialog (replaces CsvImportModal).
// Opened from the Meet page (Import Registrations) and from every event's
// Registration tab (Import Registrations…, which passes eventId as a filter).
// One modal, up to five panels: File → Columns (only when a header is unknown
// or two headers map to one field) → Events (only when a marker is unresolved)
// → Preview (always) → Result. Every panel change re-runs the server preview;
// the commit re-runs it once more from the file and refuses if anything moved.

const FIELD_OPTIONS = [
  ['', 'Ignore this column'],
  ['last_name', 'Last name'],
  ['first_name', 'First name'],
  ['gender', 'Gender'],
  ['birth_year', 'Birth year / date'],
  ['ussa_num', 'USSS #'],
  ['fis_id', 'FIS id'],
  ['club', 'Club / team'],
  ['nation', 'Nation'],
  ['bib', 'Bib'],
  ['category', 'Category entered (SkiReg)'],
  ['events', 'Events codes (Winfree)'],
]

const REASON_TEXT = {
  saved: 'Saved mapping',
  rules: 'Matched',
  default_event: 'This event (file has no entry information)',
  not_an_event: 'Not an event',
  other_gender: 'Other gender — not this event',
  no_gender: 'No gender on the row or in the text — pick an event',
  no_discipline: 'No discipline word (moguls / dual / aerials) — pick an event',
  no_event: 'No event of that gender and discipline in this meet',
  date_mismatch: 'The date in the text matches none of the events — pick one',
  ambiguous: 'More than one event fits — pick one',
}

const FLAG_TEXT = {
  no_usss_match: 'Not found in the USSS People File (no USSS #)',
  ambiguous_usss: 'Several USSS People File records share this name',
  duplicate_ussa_num: 'USSS # / name conflict inside the file',
  bad_ussa_num: 'USSS # in the file is not 5–8 digits',
  bad_birth_year: 'Birth year could not be read',
  bad_gender: 'Gender could not be read',
  gender_conflict: 'Row gender disagrees with the category text',
  no_gender: 'No gender',
  no_name: 'No name',
  bad_events_code: 'Unknown code in the Events column',
  unresolved_marker: 'An entry marker is not mapped yet',
}

const SOURCE_BADGE = {
  ussa: ['USSS #', 'bg-slate-700 text-slate-200'],
  fis: ['FIS id', 'bg-slate-700 text-slate-200'],
  usss_people: ['People File', 'bg-blue-900/50 text-blue-300 border border-blue-800'],
  athletes: ['Name match', 'bg-slate-700 text-slate-300'],
  new: ['New', 'bg-green-900/40 text-green-400 border border-green-800'],
}

function genderWord(g) { return g === 'F' ? "Women's" : g === 'M' ? "Men's" : '' }

export default function RegistrationImportDialog({ meetId, meetName, eventId = null, eventName = '', onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [overrides, setOverrides] = useState({})       // { header: field | '' }
  const [mapping, setMapping] = useState([])           // [{ marker_norm, gender, event_id, marker_display }]
  const [included, setIncluded] = useState(new Set())  // flagged row keys ticked
  const [showColumns, setShowColumns] = useState(false)
  const [open, setOpen] = useState({ already: false, notin: false })
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  const eventsById = useMemo(() => {
    const m = new Map()
    for (const e of (preview?.events || [])) m.set(e.event_id, e)
    return m
  }, [preview])

  const eventLabel = (id) => {
    const e = eventsById.get(id)
    if (!e) return '—'
    return e.import_code ? `${e.name} (${e.import_code})` : e.name
  }

  const buildForm = (opts = {}) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    if (eventId) fd.append('event_id', eventId)
    const ov = opts.overrides ?? overrides
    const mp = opts.mapping ?? mapping
    const inc = opts.included ?? included
    if (Object.keys(ov).length) fd.append('column_overrides', JSON.stringify(Object.fromEntries(Object.entries(ov).map(([h, f]) => [h, f || 'ignore']))))
    if (mp.length) fd.append('mapping', JSON.stringify(mp))
    if (inc.size) fd.append('include_flagged', JSON.stringify([...inc]))
    if (opts.preview_token) fd.append('preview_token', opts.preview_token)
    return fd
  }

  const runPreview = async (opts = {}) => {
    if (!file) return
    setError(''); setLoading(true)
    try {
      const data = await api.importRegistrations(meetId, buildForm(opts), 'preview')
      setPreview(data)
      // Keep only ticks that still exist as flagged rows.
      const flaggedKeys = new Set(data.athletes.needs_attention.map(r => r.key))
      setIncluded(prev => new Set([...prev].filter(k => flaggedKeys.has(k))))
      if (data.columns.unmapped.length || (data.columns.duplicates || []).length) setShowColumns(true)
    } catch (e) {
      setError(describeError(e))
    } finally { setLoading(false) }
  }

  const changeOverride = (header, field) => {
    const next = { ...overrides, [header]: field }
    setOverrides(next)
    runPreview({ overrides: next })
  }

  const changeMapping = (marker, value) => {
    const event_id = value === '__none' ? null : value === '' ? undefined : value
    const next = mapping.filter(m => !(m.marker_norm === marker.marker_norm && (m.gender || '') === (marker.gender || '')))
    if (event_id !== undefined) next.push({ marker_norm: marker.marker_norm, gender: marker.gender || null, event_id, marker_display: marker.marker_display })
    // When the Events step is shown, carry the resolved rows too so the whole
    // confirmed table is saved with the meet (section 3.4).
    setMapping(next)
    runPreview({ mapping: next })
  }

  const confirmedTable = () => {
    if (!preview) return mapping
    const rows = mapping.slice()
    for (const m of preview.markers) {
      if (m.resolution && !rows.some(r => r.marker_norm === m.marker_norm && (r.gender || '') === (m.gender || ''))) {
        rows.push({ marker_norm: m.marker_norm, gender: m.gender || null, event_id: m.resolution.event_id, marker_display: m.marker_display })
      }
    }
    return rows
  }

  const toggleInclude = (key) => {
    const next = new Set(included)
    next.has(key) ? next.delete(key) : next.add(key)
    setIncluded(next)
  }

  const commit = async () => {
    if (!preview) return
    setError(''); setCommitting(true)
    try {
      // The saved table only includes what the operator saw in the Events step.
      const mp = showEvents ? confirmedTable() : mapping
      // Re-run the preview with the exact mapping we will commit, so the token matches.
      const fresh = await api.importRegistrations(meetId, buildForm({ mapping: mp }), 'preview')
      if (fresh.needs_mapping) { setPreview(fresh); setError('Some entries are still not mapped to an event.'); return }
      const data = await api.importRegistrations(meetId, buildForm({ mapping: mp, preview_token: fresh.preview_token }), 'commit')
      setResult(data)
    } catch (e) {
      setError(describeError(e))
      if (e.code === 'preview_changed') runPreview()
    } finally { setCommitting(false) }
  }

  const finish = () => { if (onImported) onImported(result); onClose() }

  const showEvents = !!preview && (preview.needs_mapping || mapping.length > 0)
  const tickedCount = preview ? preview.athletes.needs_attention.filter(r => included.has(r.key) && !(r.flags || []).includes('no_name')).length : 0
  const registerCount = preview ? preview.athletes.to_register.length + tickedCount : 0
  const canConfirm = !!preview && !preview.needs_mapping && registerCount > 0 && !committing && !loading

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" data-testid="registration-import-dialog">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h3 className="font-display text-lg text-white">Import Registrations</h3>
            <div className="text-xs text-slate-500">
              {meetName || 'Meet'}{eventId ? <> · only <span className="text-slate-300">{eventName}</span> will be registered</> : ' · every event in the meet'}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl" aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap" data-testid="import-error">{error}</div>
          )}

          {result ? (
            <ResultPanel result={result} eventLabel={eventLabel} />
          ) : (
            <>
              {/* 1. File */}
              <section className="space-y-3">
                <StepTitle n={1} title="File" hint="SkiReg export (CSV or XLSX), an RMF / Winfree registration spreadsheet, or any sheet with a Last Name column." />
                <div className="flex flex-wrap items-center gap-3">
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden" data-testid="import-file"
                    onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setMapping([]); setOverrides({}); setIncluded(new Set()); setError(''); setShowColumns(false) }} />
                  <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm">Choose file…</button>
                  <span className="text-sm text-slate-300">{file ? <>{file.name} <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span></> : <span className="text-slate-500">No file chosen</span>}</span>
                  <button onClick={() => runPreview()} disabled={!file || loading} className="btn-primary text-sm disabled:opacity-50" data-testid="import-analyze">
                    {loading ? 'Analyzing…' : preview ? 'Analyze again' : 'Analyze'}
                  </button>
                  {preview && (
                    <span className="text-xs text-slate-500">
                      {preview.rows_read} rows · {preview.people_count} people · header on line {preview.header_row_index + 1}
                    </span>
                  )}
                </div>
              </section>

              {/* 2. Columns */}
              {preview && (showColumns || Object.keys(overrides).length > 0) && (
                <section className="space-y-3" data-testid="import-columns-step">
                  <StepTitle n={2} title="Columns" hint="Check how each column was read. Change any that were misread; unknown columns are ignored." />
                  {(preview.columns.duplicates || []).length > 0 && (
                    <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
                      {preview.columns.duplicates.map(d => `${d.headers.join(' and ')} both read as ${labelFor(d.field)} — the first non-empty value wins`).join('; ')}.
                    </div>
                  )}
                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800 text-slate-400 uppercase"><tr>
                        <th className="px-3 py-2 text-left">Column in file</th><th className="px-3 py-2 text-left">Read as</th><th className="px-3 py-2 text-left">Sample</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-800">
                        {preview.columns.headers.map(h => {
                          const auto = preview.columns.map[h] || ''
                          const entry = preview.columns.entry_columns.find(ec => ec.header === h)
                          const un = preview.columns.unmapped.find(u => u.header === h)
                          const val = Object.prototype.hasOwnProperty.call(overrides, h) ? overrides[h] : auto
                          return (
                            <tr key={h} className={un ? 'bg-amber-900/10' : ''}>
                              <td className="px-3 py-1.5 text-slate-200 font-mono">{h}</td>
                              <td className="px-3 py-1.5">
                                {entry ? (
                                  <span className="text-blue-300">Entry column → {entry.import_code ? `code ${entry.import_code}` : eventLabel(entry.event_id)}</span>
                                ) : (
                                  <select className="input text-xs py-1" value={val} onChange={e => changeOverride(h, e.target.value)}>
                                    {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                )}
                                {un && <span className="ml-2 text-amber-400">unknown</span>}
                              </td>
                              <td className="px-3 py-1.5 text-slate-500 truncate max-w-xs">{un ? un.sample : ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* 3. Events */}
              {showEvents && (
                <section className="space-y-3" data-testid="import-events-step">
                  <StepTitle n={showColumns ? 3 : 2} title="Events" hint="Each entry in the file must point at exactly one event of this meet, or at Not an event. The choice is saved with the meet and reused next time." />
                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800 text-slate-400 uppercase"><tr>
                        <th className="px-3 py-2 text-left">Entry in file</th><th className="px-3 py-2 text-left">Gender</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Event</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-800">
                        {preview.markers.map(m => {
                          const unresolved = m.resolution === null && !['not_an_event', 'other_gender'].includes(m.reason)
                          const value = m.resolution ? (m.resolution.event_id || '__none') : ''
                          return (
                            <tr key={`${m.marker_norm}|${m.gender || ''}`} className={unresolved ? 'bg-amber-900/10' : ''} data-testid="import-marker-row" data-unresolved={unresolved ? '1' : '0'}>
                              <td className="px-3 py-1.5 text-slate-200">{m.marker_display}</td>
                              <td className="px-3 py-1.5 text-slate-400">{genderWord(m.gender) || '—'}</td>
                              <td className="px-3 py-1.5 text-right text-slate-400">{m.count}</td>
                              <td className={`px-3 py-1.5 ${unresolved ? 'text-amber-400' : 'text-slate-500'}`}>{REASON_TEXT[m.reason] || m.reason}</td>
                              <td className="px-3 py-1.5">
                                <select className="input text-xs py-1 min-w-[16rem]" value={value} onChange={e => changeMapping(m, e.target.value)} data-testid="import-marker-select">
                                  <option value="">— choose —</option>
                                  {(preview.events || []).filter(e => !m.gender || e.gender === m.gender).map(e => (
                                    <option key={e.event_id} value={e.event_id}>{e.import_code ? `${e.name} (${e.import_code})` : e.name}</option>
                                  ))}
                                  <option value="__none">Not an event</option>
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* 4. Preview */}
              {preview && (
                <section className="space-y-4" data-testid="import-preview-step">
                  <StepTitle n={(showColumns ? 1 : 0) + (showEvents ? 1 : 0) + 2} title="Preview" hint={eventId ? `Only ${eventName} is registered from this dialog. Rows for other events are listed under Not in This Event.` : 'What Confirm Import will write. Nothing has been changed yet.'} />
                  {!preview.usss_people_loaded && (
                    <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
                      USSS People File not synced; names could not be looked up. Sync it from Admin → USSS People File to fill USSS numbers and birth years.
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid="import-event-cards">
                    {preview.events.map(e => (
                      <div key={e.event_id} className={`rounded-lg border px-3 py-2 ${eventId && e.event_id !== eventId ? 'border-slate-800 opacity-60' : 'border-slate-700 bg-slate-800/60'}`} data-testid="import-event-card">
                        <div className="text-sm text-white truncate" title={e.name}>{e.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{e.import_code || '—'} · {genderWord(e.gender)}</div>
                        <div className="mt-1 text-xs flex flex-wrap gap-x-3">
                          <span className="text-green-400">+{e.to_register} to register</span>
                          <span className="text-slate-400">{e.already_registered} already</span>
                          {e.flagged > 0 && <span className="text-amber-400">{e.flagged} flagged</span>}
                          {eventId && e.event_id !== eventId && e.not_in_this_event > 0 && <span className="text-slate-500">{e.not_in_this_event} not this event</span>}
                        </div>
                      </div>
                    ))}
                    {preview.athletes.not_an_event > 0 && (
                      <div className="rounded-lg border border-slate-800 px-3 py-2 opacity-70">
                        <div className="text-sm text-slate-300">Not an event</div>
                        <div className="text-xs text-slate-500">{preview.athletes.not_an_event} people (banquet, coaches, fees…)</div>
                      </div>
                    )}
                  </div>

                  {/* To Register */}
                  <div>
                    <div className="text-sm font-semibold text-white mb-2">To Register ({preview.athletes.to_register.length})</div>
                    {preview.athletes.to_register.length === 0 ? (
                      <div className="text-sm text-slate-500 italic">Nothing new to register.</div>
                    ) : (
                      <AthleteTable rows={preview.athletes.to_register} eventLabel={eventLabel} />
                    )}
                  </div>

                  {/* Needs Attention */}
                  {preview.athletes.needs_attention.length > 0 && (
                    <div data-testid="import-needs-attention">
                      <div className="text-sm font-semibold text-amber-400 mb-1">Needs Attention ({preview.athletes.needs_attention.length})</div>
                      <div className="text-xs text-slate-500 mb-2">These are not registered unless you tick them. Missing USSS # or birth year shows as a red row on the Registration tab, where it can be fixed later.</div>
                      <div className="border border-amber-900/60 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-800 text-slate-400 uppercase"><tr>
                            <th className="px-2 py-2"><input type="checkbox" className="rounded border-slate-600"
                              checked={preview.athletes.needs_attention.every(r => included.has(r.key) || (r.flags || []).includes('no_name'))}
                              onChange={e => setIncluded(e.target.checked ? new Set(preview.athletes.needs_attention.filter(r => !(r.flags || []).includes('no_name')).map(r => r.key)) : new Set())} /></th>
                            <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">USSS #</th><th className="px-3 py-2 text-left">Born</th><th className="px-3 py-2 text-left">Club</th><th className="px-3 py-2 text-left">Events</th><th className="px-3 py-2 text-left">Why</th>
                          </tr></thead>
                          <tbody className="divide-y divide-slate-800">
                            {preview.athletes.needs_attention.map(r => {
                              const noName = (r.flags || []).includes('no_name')
                              return (
                                <tr key={r.key} className="text-slate-300">
                                  <td className="px-2 py-1.5"><input type="checkbox" className="rounded border-slate-600" disabled={noName} checked={included.has(r.key)} onChange={() => toggleInclude(r.key)} data-testid="import-flag-tick" /></td>
                                  <td className="px-3 py-1.5">{r.last_name}, {r.first_name} <span className="text-slate-600">(row {r.rows?.[0]})</span></td>
                                  <td className="px-3 py-1.5 text-slate-500 font-mono">{r.ussa_num || '—'}</td>
                                  <td className="px-3 py-1.5 text-slate-500">{r.birth_year || '—'}</td>
                                  <td className="px-3 py-1.5 text-slate-500 truncate max-w-[10rem]">{r.club || ''}</td>
                                  <td className="px-3 py-1.5 text-slate-400">{r.events.map(eventLabel).join(', ')}</td>
                                  <td className="px-3 py-1.5 text-amber-400">
                                    {(r.flags || []).map(f => FLAG_TEXT[f] || f).join('; ')}
                                    {r.usss_candidates && <div className="text-slate-500">{r.usss_candidates.map(c => `${c.ussa_id} ${c.first_name} ${c.last_name} ${c.yob || ''} ${c.club_name || ''}`).join(' · ')}</div>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <Collapsible title={`Already Registered (${preview.athletes.already_registered.length})`} open={open.already} onToggle={() => setOpen(o => ({ ...o, already: !o.already }))} rows={preview.athletes.already_registered}
                    render={r => `${r.last_name}, ${r.first_name}${r.ussa_num ? ` (#${r.ussa_num})` : ''} — ${r.already_in.map(eventLabel).join(', ')}`} />
                  {eventId && (
                    <Collapsible title={`Not in This Event (${preview.athletes.not_in_this_event.length})`} open={open.notin} onToggle={() => setOpen(o => ({ ...o, notin: !o.notin }))} rows={preview.athletes.not_in_this_event}
                      render={r => `${r.last_name}, ${r.first_name}${r.ussa_num ? ` (#${r.ussa_num})` : ''}${r.other_events.length ? ` — ${r.other_events.map(eventLabel).join(', ')}` : ''}`} />
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {preview && !result && preview.needs_mapping && <span className="text-amber-400">Map every entry to an event before importing.</span>}
          </div>
          <div className="flex gap-3">
            {result ? (
              <button onClick={finish} className="btn-primary" data-testid="import-done">Done</button>
            ) : (
              <>
                <button onClick={onClose} className="btn-ghost">Cancel</button>
                <button onClick={commit} disabled={!canConfirm} className="btn-primary disabled:opacity-50" data-testid="import-confirm">
                  {committing ? 'Importing…' : `Confirm Import${preview ? ` (${registerCount} athletes)` : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function describeError(e) {
  if (e && e.body && e.body.error === 'no_header') {
    const rows = (e.body.first_rows || []).map(r => r.join(', ')).join('\n')
    return `No header row found (the first 20 rows have no Last Name column).\nFirst rows read:\n${rows}`
  }
  if (e && e.code === 'preview_changed') return 'The file or mapping changed since the preview — it has been analyzed again; check it and confirm once more.'
  if (e && e.code === 'meet_adopted') return 'This meet is adopted by a venue server — register on the venue server instead.'
  return (e && (e.message || e.error)) || 'Import failed'
}

function labelFor(field) { return (FIELD_OPTIONS.find(([v]) => v === field) || [])[1] || field }

function StepTitle({ n, title, hint }) {
  return (
    <div>
      <div className="text-sm font-semibold text-white"><span className="text-slate-500 mr-2">{n}.</span>{title}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

function AthleteTable({ rows, eventLabel }) {
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden max-h-80 overflow-y-auto" data-testid="import-to-register">
      <table className="w-full text-xs">
        <thead className="bg-slate-800 text-slate-400 uppercase sticky top-0"><tr>
          <th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">USSS #</th><th className="px-3 py-2 text-left">Born</th><th className="px-3 py-2 text-left">Club</th><th className="px-3 py-2 text-left">Bib</th><th className="px-3 py-2 text-left">Events</th><th className="px-3 py-2 text-left">Source</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map(r => {
            const [label, cls] = SOURCE_BADGE[r.source] || SOURCE_BADGE.new
            return (
              <tr key={r.key} className="text-slate-300" data-testid="import-to-register-row">
                <td className="px-3 py-1.5">{r.last_name}, {r.first_name}</td>
                <td className="px-3 py-1.5 text-slate-500 font-mono">{r.ussa_num || <span className="text-red-400">—</span>}</td>
                <td className="px-3 py-1.5 text-slate-500">{r.birth_year || <span className="text-red-400">—</span>}</td>
                <td className="px-3 py-1.5 text-slate-500 truncate max-w-[12rem]" title={r.club || ''}>{r.club || ''}</td>
                <td className="px-3 py-1.5">{r.bib ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-3 py-1.5 text-slate-400">{r.events.map(eventLabel).join(', ')}{r.already_in.length > 0 && <span className="text-slate-600"> (+{r.already_in.length} already)</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide whitespace-nowrap ${cls}`}>{label}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Collapsible({ title, rows, open, onToggle, render }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="border border-slate-800 rounded-lg">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
        <span>{title}</span><span className="text-slate-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-slate-800 text-xs text-slate-400 space-y-1 max-h-48 overflow-y-auto">
          {rows.map((r, i) => <div key={r.key || i}>{render(r)}</div>)}
        </div>
      )}
    </div>
  )
}

function ResultPanel({ result, eventLabel }) {
  const ins = result.inserted || {}
  return (
    <div className="space-y-4" data-testid="import-result">
      <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 text-sm space-y-1">
        <div className="text-green-400 font-semibold">Import complete</div>
        <div className="text-slate-300">Registrations added: <strong>{ins.registrations || 0}</strong></div>
        <div className="text-slate-300">Athletes created: <strong>{ins.athletes_created || 0}</strong> · updated: <strong>{ins.athletes_updated || 0}</strong></div>
        {result.mapping_saved > 0 && <div className="text-slate-400">Entry mappings saved with the meet: {result.mapping_saved}</div>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {(result.events || []).filter(e => e.to_register || e.already_registered || e.flagged).map(e => (
          <div key={e.event_id} className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
            <div className="text-sm text-white truncate">{e.name}</div>
            <div className="text-xs text-slate-400">+{e.to_register} · {e.already_registered} already registered</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Next: on each event's Registration tab, run <strong>Sync with USSS Database</strong> to fill anything still missing, then assign bibs.</p>
    </div>
  )
}
