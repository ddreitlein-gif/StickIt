import { useState, useEffect, useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { GROUPS, topicsInGroup, searchTopics } from './topicsIndex'

function readHelpReferrer() {
  try {
    const v = sessionStorage.getItem('stickit.help.referrer')
    if (!v) return '/'
    // Never loop back into /help
    if (v.startsWith('/help')) return '/'
    return v
  } catch {
    return '/'
  }
}

export default function HelpSidebar({ activeSlug, searchQuery, onNavigate }) {
  const navigate = useNavigate()
  const backTarget = readHelpReferrer()
  const matchingSlugs = useMemo(() => {
    if (!searchQuery.trim()) return null
    const matches = searchTopics(searchQuery)
    return new Set(matches.map(t => t.slug))
  }, [searchQuery])

  // Track open/closed state per group. Default: open the group that contains
  // the active topic.
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {}
    GROUPS.forEach(g => { initial[g.id] = false })
    initial['getting-started'] = true
    return initial
  })

  useEffect(() => {
    if (!activeSlug) return
    // Find which group the active slug lives in, and open it.
    for (const g of GROUPS) {
      const inGroup = topicsInGroup(g.id).some(t => t.slug === activeSlug)
      if (inGroup) {
        setOpenGroups(prev => ({ ...prev, [g.id]: true }))
        break
      }
    }
  }, [activeSlug])

  // When searching, force all groups with matches open
  useEffect(() => {
    if (!matchingSlugs) return
    const next = { ...openGroups }
    GROUPS.forEach(g => {
      const hasMatch = topicsInGroup(g.id).some(t => matchingSlugs.has(t.slug))
      if (hasMatch) next[g.id] = true
    })
    setOpenGroups(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingSlugs])

  return (
    <nav className="help-sidebar-nav">
      <button
        type="button"
        className="help-sidebar-back"
        onClick={() => {
          if (onNavigate) onNavigate()
          navigate(backTarget)
        }}
      >
        <span className="help-sidebar-back-arrow">←</span>
        <span>Back</span>
      </button>
      {GROUPS.map(group => {
        const topics = topicsInGroup(group.id)
        const visible = matchingSlugs
          ? topics.filter(t => matchingSlugs.has(t.slug))
          : topics
        if (matchingSlugs && visible.length === 0) return null
        const isOpen = openGroups[group.id] || !!matchingSlugs
        return (
          <div key={group.id} className="help-sidebar-group">
            <button
              className="help-sidebar-group-header"
              onClick={() => setOpenGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
            >
              <span className={`help-sidebar-caret ${isOpen ? 'open' : ''}`}>▸</span>
              <span>{group.label}</span>
              <span className="help-sidebar-group-count">{visible.length}</span>
            </button>
            {isOpen && (
              <ul className="help-sidebar-topics">
                {visible.map(t => (
                  <li key={t.slug}>
                    <NavLink
                      to={`/help/${t.slug}`}
                      className={({ isActive }) =>
                        `help-sidebar-topic ${isActive ? 'active' : ''}`
                      }
                      onClick={onNavigate}
                    >
                      {t.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
