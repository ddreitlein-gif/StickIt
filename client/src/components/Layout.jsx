import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

const NAV_ALL = [
  { to: '/dashboard', label: 'Meets', icon: '&#127942;', exact: true },
  { to: '/dashboard/athletes', label: 'Athletes', icon: '&#9975;' },
  { to: '/dashboard/usss', label: 'USSS Database', icon: '&#128203;' },
]
const NAV_JUDGE = [
  { to: '/dashboard', label: 'Meets', icon: '&#127942;', exact: true },
]

// ── Jump DD Reference Panel ──────────────────────────────────────────────────
function JumpDDReference({ onClose }) {
  const [discipline, setDiscipline] = useState('mogul')
  const [gender, setGender] = useState('M')
  const [dds, setDds] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/jump-dds?ruleset=uss&discipline=${discipline}&gender=${gender}`)
      .then(r => r.json())
      .then(rows => setDds(rows || []))
      .catch(() => setDds([]))
      .finally(() => setLoading(false))
  }, [discipline, gender])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-display text-lg text-white">Degree of Difficulty Reference</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">&#10005;</button>
        </div>
        <div className="px-5 py-3 flex gap-3 border-b border-slate-800">
          <select
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
            value={discipline}
            onChange={e => setDiscipline(e.target.value)}
          >
            <option value="mogul">Mogul</option>
            <option value="dual_mogul">Dual Mogul</option>
            <option value="aerials">Aerials</option>
          </select>
          <select
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
            value={gender}
            onChange={e => setGender(e.target.value)}
          >
            <option value="M">Men</option>
            <option value="F">Women</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : !dds.length ? (
            <p className="text-slate-500 text-sm">No DD values found for this combination.</p>
          ) : (
            <>
              <p className="text-slate-500 text-xs mb-3">
                US Ski &amp; Snowboard {discipline === 'dual_mogul' ? 'Dual Mogul (x1.25 applied)' : discipline === 'aerials' ? 'Aerials' : 'Mogul'} ({gender === 'F' ? 'Women' : 'Men'})
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {dds.map(d => (
                  <div key={d.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2">
                    <span className="font-mono text-white text-sm">{d.jump_code}</span>
                    <span className="font-mono text-blue-400 text-sm">{Number(d.dd_value).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── About Panel ──────────────────────────────────────────────────────────────
function AboutPanel({ onClose }) {
  const [version, setVersion] = useState('v1.30.00')
  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => d.version && setVersion(d.version)).catch(() => {})
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="font-display text-lg text-white">About</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">&#10005;</button>
        </div>
        <div className="px-5 py-6 text-center space-y-4">
          <img src="/logo.png" alt="StickIt" className="h-20 w-auto mx-auto" />
          <div>
            <p className="font-display text-2xl tracking-wide">
              <span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span>
            </p>
            <p className="text-slate-400 text-sm mt-1">Freestyle Mogul Scoring Application</p>
          </div>
          <div className="text-slate-500 text-sm space-y-1">
            <p>Version {version.replace(/^v/, '')}</p>
            <p>&copy; 2026 Rocky Mountain Freestyle.  All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showDDs, setShowDDs] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [version, setVersion] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const { user, authEnabled, logout } = useAuth()
  const NAV = user?.role === 'judge' ? NAV_JUDGE : NAV_ALL

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(d => d.version && setVersion(d.version))
      .catch(() => {})
  }, [])

  // Shared classes for sidebar action buttons (modal triggers / external nav)
  const sidebarActionBtnClass =
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-slate-400 hover:text-white hover:bg-slate-800 w-full text-left'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-16'} flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-200`}>
        {/* Logo */}
        <div className={`${sidebarOpen ? 'px-4 py-4' : 'px-2 py-3'} flex items-center ${sidebarOpen ? 'gap-3' : 'justify-center'} border-b border-slate-800`}>
          <img
            src="/logo.png"
            alt="StickIt"
            className={sidebarOpen ? 'h-16 w-auto' : 'h-10 w-auto'}
          />
          {sidebarOpen && (
            <div className="flex flex-col justify-center">
              <p className="font-display text-3xl font-bold leading-none tracking-wide">
                <span className="text-white">Stick</span><span style={{ color: '#EF4444' }}>It</span>
              </p>
              <p className="text-[10px] text-slate-500 tracking-widest uppercase mt-1">{version || ' '}</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavLink
            to="/"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors mb-2"
          >
            <span dangerouslySetInnerHTML={{ __html: '&#8592;' }} />
            {sidebarOpen && <span>Home</span>}
          </NavLink>
          {NAV.map(({ to, label, icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                 ${isActive
                   ? 'text-white bg-mountain-600/20 border border-mountain-600/30'
                   : 'text-slate-400 hover:text-white hover:bg-slate-800'}`
              }
            >
              <span className="text-lg" dangerouslySetInnerHTML={{ __html: icon }} />
              {sidebarOpen && <span>{label}</span>}
            </NavLink>
          ))}

          {/* Reference / help — modal triggers + external navigation */}
          <div className="mt-4 pt-3 border-t border-slate-800 space-y-1">
            <button
              onClick={() => setShowDDs(true)}
              className={sidebarActionBtnClass}
            >
              <span className="text-lg">&#128200;</span>
              {sidebarOpen && <span>Jump DDs</span>}
            </button>
            <button
              onClick={() => {
                try { sessionStorage.setItem('stickit.help.referrer', location.pathname + location.search) } catch {}
                navigate('/help')
              }}
              className={sidebarActionBtnClass}
            >
              <span className="text-lg">&#128214;</span>
              {sidebarOpen && <span>User Guide</span>}
            </button>
            <button
              onClick={() => setShowAbout(true)}
              className={sidebarActionBtnClass}
            >
              <span className="text-lg">&#9881;</span>
              {sidebarOpen && <span>About</span>}
            </button>
          </div>
        </nav>

        {/* Account block — shown only when auth is enabled and user is logged in */}
        {authEnabled && user && sidebarOpen && (
          <div className="px-3 pb-2 border-t border-slate-800 pt-2">
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

        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="m-3 p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors text-xs"
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Modal panels */}
      {showDDs && <JumpDDReference onClose={() => setShowDDs(false)} />}
      {showAbout && <AboutPanel onClose={() => setShowAbout(false)} />}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  )
}
