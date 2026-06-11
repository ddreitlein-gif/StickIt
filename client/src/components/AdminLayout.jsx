import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

// v1.25.00 (B-10) — inline SVG icons (consistent rendering across platforms,
// replacing emoji) in the stroke style used on Home.jsx.
const I = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></>,
  security:  <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  users:     <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5a5 5 0 0 1 6 4.9"/></>,
  events:    <><path d="M3 20l6-14 4 9 3-5 5 10z"/></>,
  usss:      <><circle cx="12" cy="7" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M19 8l1.5 1.5L23 7"/></>,
  athletes:  <><circle cx="14" cy="5" r="2.5"/><path d="M5 21l4-6 3-2-1-5 4 2 2 3"/><path d="M9 13l-3 1"/></>,
  backups:   <><ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/></>,
  audit:     <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  help:      <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></>,
}

function NavIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      {I[name]}
    </svg>
  )
}

const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/admin/security', label: 'Security', icon: 'security' },
  { to: '/admin/users', label: 'Users', icon: 'users' },
  { to: '/admin/events', label: 'Events', icon: 'events' },
  { to: '/admin/usss-people', label: 'USSS People', icon: 'usss' },
  { to: '/admin/athletes', label: 'Athletes', icon: 'athletes' },
  { to: '/admin/backups', label: 'Backups', icon: 'backups' },
  { to: '/admin/audit', label: 'Audit Log', icon: 'audit' },
  { to: '/help', label: 'Help', icon: 'help' },
]

export default function AdminLayout() {
  const [showChangePw, setShowChangePw] = useState(false)
  const { user, authEnabled, logout } = useAuth()
  const navigate = useNavigate()

  // v1.25.00 (B-10) — collapse the sidebar to icon-only below 900px.
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900)
  useEffect(() => {
    const onResize = () => setCollapsed(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a1628', fontFamily: "'Barlow', sans-serif", color: '#e8f0f8' }}>
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-14' : 'w-56'} flex-shrink-0 bg-slate-900/80 border-r border-slate-700/50 flex flex-col transition-all`}>
        <div className={`${collapsed ? 'px-2' : 'px-4'} py-4 border-b border-slate-700/50`}>
          <h1 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-xl font-bold tracking-wide uppercase text-white text-center">
            {collapsed ? 'A' : 'Admin Panel'}
          </h1>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <Link
            to="/"
            title="Home"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors mb-3"
          >
            <span>&larr;</span> {!collapsed && 'Home'}
          </Link>

          {ADMIN_NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              onClick={() => {
                if (to === '/help') {
                  try { sessionStorage.setItem('stickit.help.referrer', window.location.pathname + window.location.search) } catch {}
                }
              }}
              className={({ isActive }) =>
                `flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              <NavIcon name={icon} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Account block — shown only when auth is enabled and user is logged in */}
        {authEnabled && user && !collapsed && (
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
