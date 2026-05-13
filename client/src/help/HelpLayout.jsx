import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import HelpSidebar from './HelpSidebar'
import './help.css'

export default function HelpLayout({ activeSlug, children }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => d.version && setVersion(d.version)).catch(() => {})
  }, [])

  // Collapse the sidebar on narrow viewports by default
  useEffect(() => {
    if (window.innerWidth < 720) setSidebarOpen(false)
  }, [])

  return (
    <div className="help-root">
      <header className="help-topbar">
        <div className="help-topbar-left">
          <button
            className="help-sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Toggle topic sidebar"
          >
            ☰
          </button>
          <Link to="/" className="help-topbar-brand">
            <img src="/logo.png" alt="StickIt" />
            <span>
              <span style={{ color: '#fff' }}>Stick</span><span style={{ color: '#EF4444' }}>It</span>
            </span>
          </Link>
          <span className="help-topbar-subtitle">User Guide</span>
        </div>
        <div className="help-topbar-search">
          <input
            type="search"
            placeholder="Search the guide..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="help-search-clear">×</button>
          )}
        </div>
        <div className="help-topbar-right">
          <Link to="/dashboard" className="help-topbar-link">Officials</Link>
          <Link to="/livescores" className="help-topbar-link">Live Scores</Link>
          {version && <span className="help-topbar-version">{version}</span>}
        </div>
      </header>
      <div className="help-shell">
        {sidebarOpen && (
          <aside className="help-sidebar">
            <HelpSidebar
              activeSlug={activeSlug}
              searchQuery={searchQuery}
              onNavigate={() => { if (window.innerWidth < 720) setSidebarOpen(false) }}
            />
          </aside>
        )}
        <main className="help-content">
          {children}
        </main>
      </div>
    </div>
  )
}
