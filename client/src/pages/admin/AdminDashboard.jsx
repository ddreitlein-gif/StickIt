import { useState, useEffect, useRef } from 'react'
import { authHeaders, checkApiResponse } from '../../utils/api'

function fmtUptime(secs) {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h || d) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString()
}

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorsOpen, setErrorsOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const intervalRef = useRef(null)

  const load = () => {
    fetch('/api/admin/dashboard', { headers: authHeaders() })
      .then(checkApiResponse)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 30000)
    return () => clearInterval(intervalRef.current)
  }, [])

  if (loading) return <div className="text-slate-500 py-8 text-center">Loading...</div>
  if (!data) return <div className="text-red-400 py-8 text-center">Failed to load dashboard data.</div>

  const diskPct = data.disk.total_bytes > 0
    ? ((1 - data.disk.free_bytes / data.disk.total_bytes) * 100).toFixed(1)
    : 0
  const diskUsed = data.disk.total_bytes - data.disk.free_bytes

  return (
    <div>
      <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white mb-6">
        Dashboard
      </h2>

      {/* Row 1: Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Server Uptime" value={fmtUptime(data.uptime_seconds)} color="text-green-400" />
        <MetricCard label="App Version" value={data.version} color="text-blue-400" />
        <MetricCard label="WebSocket Connections" value={data.ws_connections} color="text-cyan-400" />
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">System IP</div>
          {data.ip_addresses.length > 0 ? (
            <div className="space-y-1">
              {data.ip_addresses.map((ip, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }} className="text-lg font-bold text-amber-400">
                    {ip.address}
                  </span>
                  <span className="text-xs text-slate-600">:{data.port}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm">No network interfaces</div>
          )}
        </div>
      </div>

      {/* Row 2: Run Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-blue-500/30 bg-blue-900/10 p-4 text-center">
          <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-3xl font-bold text-blue-400">
            {data.runs.scoring}
          </div>
          <div className="text-xs text-slate-400 uppercase tracking-wider mt-1 flex items-center justify-center gap-1.5">
            {data.runs.scoring > 0 && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
            Active Runs
          </div>
        </div>
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-900/10 p-4 text-center">
          <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-3xl font-bold text-yellow-400">
            {data.runs.pending}
          </div>
          <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Pending Runs</div>
        </div>
        <div className="rounded-xl border border-green-500/30 bg-green-900/10 p-4 text-center">
          <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-3xl font-bold text-green-400">
            {data.runs.complete}
          </div>
          <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">Complete Runs</div>
        </div>
      </div>

      {/* Row 3: Database */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 mb-6">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-4">Database</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
          {[
            { label: 'Meets', value: data.counts.meets },
            { label: 'Events', value: data.counts.events },
            { label: 'Athletes', value: data.counts.athletes },
            { label: 'Registrations', value: data.counts.registrations },
            { label: 'Users', value: data.counts.users },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-slate-900/50 p-3 text-center">
              <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-xl font-bold text-white">{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-slate-400">
          <span>DB Size: <strong className="text-white">{fmtBytes(data.db.file_size_bytes)}</strong></span>
          <span>Last Backup: <strong className="text-white">{fmtTime(data.db.last_backup)}</strong></span>
          <span>Backups: <strong className="text-white">{data.db.backup_count}</strong></span>
        </div>
      </div>

      {/* Row 4: Disk Space */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 mb-6">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Disk Space</div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${diskPct > 90 ? 'bg-red-500' : diskPct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${diskPct}%` }}
              />
            </div>
          </div>
          <div className="text-sm text-slate-300 whitespace-nowrap">
            {fmtBytes(diskUsed)} / {fmtBytes(data.disk.total_bytes)} ({diskPct}%)
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-2">{fmtBytes(data.disk.free_bytes)} free</div>
      </div>

      {/* Row 5: Error Log */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 mb-6">
        <button
          onClick={() => setErrorsOpen(!errorsOpen)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Error Log</span>
            {data.errors.length > 0 && (
              <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">{data.errors.length}</span>
            )}
          </div>
          <span className="text-slate-500">{errorsOpen ? '\u25B2' : '\u25BC'}</span>
        </button>
        {errorsOpen && (
          <div className="px-5 pb-5">
            {data.errors.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">No errors since server start.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-700">
                      <th className="pb-2 pr-4">Time</th>
                      <th className="pb-2 pr-4">Method</th>
                      <th className="pb-2 pr-4">URL</th>
                      <th className="pb-2">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.map((e, i) => (
                      <tr key={i} className="border-b border-slate-800 text-slate-400">
                        <td className="py-1.5 pr-4 whitespace-nowrap text-xs">{fmtTime(e.timestamp)}</td>
                        <td className="py-1.5 pr-4 text-xs font-mono">{e.method}</td>
                        <td className="py-1.5 pr-4 text-xs font-mono text-slate-500 max-w-[200px] truncate">{e.url}</td>
                        <td className="py-1.5 text-red-400 text-xs">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 6: Audit Log */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30">
        <button
          onClick={() => setAuditOpen(!auditOpen)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <span className="text-xs text-slate-400 uppercase tracking-wider">Recent Activity</span>
          <span className="text-slate-500">{auditOpen ? '\u25B2' : '\u25BC'}</span>
        </button>
        {auditOpen && (
          <div className="px-5 pb-5">
            {data.audit_log.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">No recent activity.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-700">
                      <th className="pb-2 pr-4">Time</th>
                      <th className="pb-2 pr-4">Action</th>
                      <th className="pb-2 pr-4">Entity</th>
                      <th className="pb-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audit_log.map((a, i) => (
                      <tr key={i} className="border-b border-slate-800 text-slate-400">
                        <td className="py-1.5 pr-4 whitespace-nowrap text-xs">{fmtTime(a.timestamp)}</td>
                        <td className="py-1.5 pr-4 text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{a.action}</span>
                        </td>
                        <td className="py-1.5 pr-4 text-xs text-slate-500">{a.entity}</td>
                        <td className="py-1.5 text-xs text-slate-500 max-w-[300px] truncate">
                          {a.new_value ? (typeof a.new_value === 'string' ? a.new_value : JSON.stringify(a.new_value)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auth Notice */}
      <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Authentication Status</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-sm text-amber-400">Not Implemented</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Authentication and role-based access control will be added in a future build.
        </p>
      </div>
    </div>
  )
}

function MetricCard({ label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div style={{ fontFamily: "'Oswald', sans-serif" }} className={`text-2xl font-bold ${color || 'text-white'}`}>
        {value}
      </div>
    </div>
  )
}
