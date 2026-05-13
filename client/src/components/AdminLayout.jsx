import { Outlet, NavLink, Link } from 'react-router-dom'

const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: '\u2139' },
  { to: '/admin/users', label: 'Users', icon: '\u2699' },
  { to: '/admin/events', label: 'Events', icon: '\u26F7' },
  { to: '/admin/usss-people', label: 'USSS People', icon: '\uD83D\uDC65' },
  { to: '/admin/athletes', label: 'Athletes', icon: '\uD83C\uDFC3' },
  { to: '/admin/backups', label: 'Backups', icon: '\uD83D\uDCBE' },
  { to: '/admin/audit', label: 'Audit Log', icon: '\uD83D\uDCCB' },
  { to: '/help', label: 'Help', icon: '\uD83D\uDCD6' },
]

export default function AdminLayout() {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a1628', fontFamily: "'Barlow', sans-serif", color: '#e8f0f8' }}>
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-slate-900/80 border-r border-slate-700/50 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-700/50">
          <h1 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-xl font-bold tracking-wide uppercase text-white">
            Admin Panel
          </h1>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors mb-3"
          >
            <span>&larr;</span> Home
          </Link>

          {ADMIN_NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
