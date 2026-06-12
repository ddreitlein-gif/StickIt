// Card grid for the Printable Guides page (/help/printable-guides).
// The PDFs are static files generated at release time by
// server/scripts/build_guide_pdfs.js and served from /docs/guides/.

const GUIDES = [
  {
    file: 'StickIt_QuickStart_Judges.pdf',
    title: 'Judges',
    audience: 'Anyone scoring on a judge tablet',
    pages: 3,
    desc: 'Connecting the tablet, what to score in moguls / duals / aerials, and what to do when a score is sent back.',
  },
  {
    file: 'StickIt_QuickStart_Chief_of_Score.pdf',
    title: 'Chief of Score',
    audience: 'The on-site operator on event day',
    pages: 4,
    desc: 'Running the scoring flow, fixing scores and registrations mid-event, printing reports during the day, end-of-day steps.',
  },
  {
    file: 'StickIt_QuickStart_Event_Secretary.pdf',
    title: 'Event Secretary',
    audience: 'Pre- and post-event setup, often from home',
    pages: 4,
    desc: 'Creating the meet and events, USSS sync, registration, bibs and run order, training days, USSS transmit and archiving.',
  },
  {
    file: 'StickIt_QuickStart_Timekeeper.pdf',
    title: 'Timekeeper',
    audience: 'The person entering run times',
    pages: 2,
    desc: 'The timing tablet screen, entering times, No Time, manual top/bottom calculation, starting runs and DNS.',
  },
  {
    file: 'StickIt_QuickStart_Live_Stream.pdf',
    title: 'Live Stream Crew',
    audience: 'Broadcast, lodge TVs, and results screens',
    pages: 2,
    desc: 'Scoreboard and Overlay URLs, OBS / YoloBox setup, hiding the overlay during interviews, troubleshooting.',
  },
]

const COMPLETE = {
  file: 'StickIt_Complete_User_Guide.pdf',
  title: 'Complete User Guide',
  audience: 'Every topic in this help system, as one PDF',
  desc: 'The full user guide — all topics with a table of contents and clickable cross-references. Suitable for printing or offline reading.',
}

function GuideCard({ guide, featured = false }) {
  const href = `/docs/guides/${guide.file}`
  return (
    <div className={`help-guide-card${featured ? ' help-guide-card-featured' : ''}`}>
      <div className="help-guide-card-title">{guide.title}</div>
      <div className="help-guide-meta">
        {guide.audience}
        {guide.pages ? ` · ${guide.pages} page${guide.pages !== 1 ? 's' : ''} + cover` : ''}
      </div>
      <p className="help-guide-desc">{guide.desc}</p>
      <div className="help-guide-actions">
        <a className="help-guide-btn help-guide-btn-primary" href={href} target="_blank" rel="noopener noreferrer">
          View
        </a>
        <a className="help-guide-btn" href={href} download={guide.file}>
          Download
        </a>
      </div>
    </div>
  )
}

export default function PrintableGuides() {
  return (
    <div>
      <h2 className="help-h2">Printable PDF guides</h2>
      <p className="help-p">
        Short, plain-language Quick Start Guides for each role — designed to print and hand out on
        event morning — plus the Complete User Guide as a single PDF.{' '}
        <strong className="help-bold">View</strong> opens the PDF in a new browser tab;{' '}
        <strong className="help-bold">Download</strong> saves a copy.
      </p>
      <div className="help-guide-grid">
        {GUIDES.map(g => <GuideCard key={g.file} guide={g} />)}
        <GuideCard guide={COMPLETE} featured />
      </div>
    </div>
  )
}
