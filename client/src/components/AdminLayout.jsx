import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: '\u2139' },
  { to: '/admin/security', label: 'Security', icon: '\ud83d\udd12' },
  { to: '/admin/users', label: 'Users', icon: '\u2699' },
  { to: '/admin/events', label: 'Events', icon: '\u26F7' },
  { to: '/admin/usss-people', label: 'USSS People', icon: '\uD83D\uDC65' },
  { to: '/admin/athletes', label: 'Athletes', icon: '\uD83C\uDFC3' },
  { to: '/admin/backups', label: 'Backups', icon: '\uD83D\uDCBE' },
  { to: '/admin/audit', label: 'Audit Log', icon: '\uD83D\uDCCB' },
  { to: '/help', label: 'Help', icon: '\uD83D\uDCD6' },
]

export default function AdminLayout() {
  const [showChangePw, setShowChangePw] = useState(false)
  const { user, authEnabled, logout } = useAuth()
  const navigate = useNavigate()

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
              onClick={() => {
                if (to === '/help') {
                  try { sessionStorage.setItem('stickit.help.referrer', window.location.pathname + window.location.search) } catch {}
                }
              }}
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

        {/* Account block — shown only when auth is enabled and user is logged in */}
        {authEnabled && user && (
          <div className="px-3 pb-3 border-t border-slate-700/50 pt-2">
            <div className="text-xs text-slate-400 truncate mb-1">{user.display_name}</div>
            <div className="flex gap-1">
              <button
                onClick={() => setShowChangePw(true)}
                className="flex-1 text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                Password
              </button>
              <button
                onClick={async () => { await logout(); navigate('/'); }}
                className="flex-1 text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
              >
                Log Out
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  )
}
