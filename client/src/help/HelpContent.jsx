import { Link } from 'react-router-dom'
import MarkdownRenderer from './MarkdownRenderer'
import { neighbors, TOPICS_BY_SLUG, GROUPS } from './topicsIndex'

export default function HelpContent({ slug, notFound }) {
  const topic = slug ? TOPICS_BY_SLUG[slug] : null
  const { prev, next } = slug ? neighbors(slug) : { prev: null, next: null }

  if (!slug) {
    return <LandingPane />
  }

  if (notFound || !topic) {
    return (
      <div className="help-content-inner">
        <div className="help-not-found">
          <strong>Topic not found.</strong> The page you tried to open does not exist.
        </div>
        <LandingPane embedded />
      </div>
    )
  }

  return (
    <div className="help-content-inner">
      <div className="help-breadcrumb">
        <Link to="/help" className="help-link">Help</Link>
        <span>›</span>
        <span>{topic.groupLabel}</span>
        <span>›</span>
        <span className="help-breadcrumb-current">{topic.title}</span>
      </div>
      <article className="help-article">
        <MarkdownRenderer source={topic.body} />
      </article>
      <nav className="help-prev-next">
        {prev ? (
          <Link to={`/help/${prev.slug}`} className="help-prev-next-card prev">
            <span className="help-prev-next-label">← Previous</span>
            <span className="help-prev-next-title">{prev.title}</span>
          </Link>
        ) : <span />}
        {next ? (
          <Link to={`/help/${next.slug}`} className="help-prev-next-card next">
            <span className="help-prev-next-label">Next →</span>
            <span className="help-prev-next-title">{next.title}</span>
          </Link>
        ) : <span />}
      </nav>
    </div>
  )
}

function LandingPane({ embedded = false }) {
  return (
    <div className={embedded ? '' : 'help-content-inner'}>
      {!embedded && (
        <>
          <h1 className="help-h1">StickIt User Guide</h1>
          <p className="help-p help-p-lead">
            Welcome. This guide covers every part of StickIt — from setting up a meet and running the scoring tablets to reading the public scoreboard and managing the system as an admin. Pick a topic from the left, or browse by audience below.
          </p>
        </>
      )}
      <div className="help-landing-grid">
        {GROUPS.map(g => (
          <Link key={g.id} to={`/help/${groupFirstSlug(g.id)}`} className="help-landing-card">
            <span className="help-landing-card-title">{g.label}</span>
            <span className="help-landing-card-arrow">→</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function groupFirstSlug(groupId) {
  // Find the first topic in this group from TOPICS_BY_SLUG
  const all = Object.values(TOPICS_BY_SLUG)
  const t = all.find(x => x.group === groupId)
  return t ? t.slug : 'welcome'
}
