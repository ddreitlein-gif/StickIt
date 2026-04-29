import { useState, useEffect } from 'react'

export default function AdminSystem() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/system')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-slate-500 py-8 text-center">Loading...</div>
  if (!data) return <div className="text-red-400 py-8 text-center">Failed to load system info.</div>

  const stats = [
    { label: 'Meets', value: data.counts.meets },
    { label: 'Events', value: data.counts.events },
    { label: 'Athletes', value: data.counts.athletes },
    { label: 'Registrations', value: data.counts.registrations },
    { label: 'Users', value: data.counts.users },
  ]

  return (
    <div>
      <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white mb-6">
        System Information
      </h2>

      {/* Version */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 mb-6">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Application Version</div>
        <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-3xl font-bold text-white tracking-wide">
          {data.version}
        </div>
      </div>

      {/* Database Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 text-center">
            <div style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold text-white">
              {s.value}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Auth Notice */}
      <div className="mt-8 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Authentication Status</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-sm text-amber-400">Not Implemented</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Authentication and role-based access control will be added in a future build.
          The users table is ready; password hashing and login endpoints need to be implemented.
        </p>
      </div>
    </div>
  )
}
