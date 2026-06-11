import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/public/PublicLayout';
import LiveDot from '../components/public/LiveDot';
import DivisionFilter from '../components/public/DivisionFilter';
import MeetPanel from '../components/public/MeetPanel';
import StatusPill from '../components/public/StatusPill';

const DIVISIONS = ['Alaska', 'Northwest', 'Far West', 'Intermountain', 'Rocky', 'Central', 'Eastern', 'National Event', 'Other'];

const DISCIPLINE_LABEL = { mogul: 'Moguls', dual_mogul: 'Dual Moguls', aerials: 'Aerials' };
const GENDER_LABEL = { M: 'Men', F: 'Women', X: 'Mixed' };

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

// Adapter: server returns meet.date but MeetPanel expects start_date.
function adaptMeet(m) {
  return { ...m, start_date: m.start_date || m.date };
}

function LiveStrip({ meets }) {
  const liveMeets = meets
    .map(m => ({ meet: m, events: (m.events || []).filter(ev => ev.status === 'active') }))
    .filter(g => g.events.length > 0);
  if (liveMeets.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <LiveDot size={8} />
        <div className="sk-display" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--red)' }}>
          LIVE NOW
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 10
      }}>
        {liveMeets.map(({ meet, events }) => (
          <div
            key={meet.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
              background: 'var(--gradient-red)',
              borderRadius: 12,
              color: '#fff',
              boxShadow: '0 4px 16px rgba(230,57,70,0.25)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <LiveDot size={6} color="#fff" />
              <div className="sk-display" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.05em', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {meet.name}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {events.map(ev => {
                const disc = DISCIPLINE_LABEL[ev.discipline] || ev.discipline;
                const gen = GENDER_LABEL[ev.gender] || '';
                const label = [gen, disc].filter(Boolean).join(' · ');
                return (
                  <Link
                    key={ev.id}
                    to={`/scoreboard/${ev.short_code || ev.id}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      background: 'rgba(255,255,255,0.18)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      borderRadius: 999,
                      color: '#fff',
                      textDecoration: 'none',
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {label} <span style={{ opacity: 0.8 }}>→</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LiveScores() {
  const [meets, setMeets] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [division, setDivision] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedMeets, setExpandedMeets] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    const fetchMeets = (showSpinner) => {
      if (showSpinner) setLoading(true);
      const params = new URLSearchParams({ page, limit: 10 });
      if (division) params.set('division', division);
      fetch(`/api/meets/livescores?${params}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          setMeets(data.meets || []);
          setTotalPages(data.totalPages || 1);
        })
        .catch(() => { if (!cancelled && showSpinner) setMeets([]); })
        .finally(() => { if (!cancelled && showSpinner) setLoading(false); });
    };
    fetchMeets(true);
    // v1.25.00 (D-1) — auto-refresh every 45s so spectators see events go
    // live/finish without reloading. Silent (no spinner, no scroll reset).
    const iv = setInterval(() => fetchMeets(false), 45000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [page, division]);

  const handleDivisionChange = (val) => {
    setDivision(val);
    setPage(1);
  };

  const toggleMeet = (meetId) => {
    setExpandedMeets(prev => {
      const next = new Set(prev);
      if (next.has(meetId)) next.delete(meetId);
      else next.add(meetId);
      return next;
    });
  };

  const adapted = useMemo(() => meets.map(adaptMeet), [meets]);

  return (
    <PublicLayout>
      <div style={{
        minHeight: '100vh',
        background: 'var(--gradient-bg)',
        paddingBottom: 80
      }}>
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg-header)', /* v1.25.00 (D-2) — follows Sun Mode */
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border)'
        }}>
          <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <Link to="/" style={{ color: 'var(--fg-muted)', textDecoration: 'none', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span>←</span> Home
              </Link>
              <h1 className="sk-display" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--fg)', margin: 0 }}>
                LIVE SCORES
              </h1>
              <div style={{ width: 60 }} />
            </div>
            <DivisionFilter divisions={DIVISIONS} value={division} onChange={handleDivisionChange} />
          </div>
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--fg-dim)' }}>Loading…</div>
          ) : adapted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--fg-dim)' }}>
              {division ? `No meets found for ${division}.` : 'No meets found.'}
            </div>
          ) : (
            <>
              <LiveStrip meets={adapted} />
              <div style={{ display: 'grid', gap: 12 }}>
                {adapted.map(meet => (
                  <MeetPanel
                    key={meet.id}
                    meet={meet}
                    expanded={expandedMeets.has(meet.id)}
                    onToggle={() => toggleMeet(meet.id)}
                  />
                ))}
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 32 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="sk-display"
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  opacity: page <= 1 ? 0.4 : 1
                }}
              >
                ← PREV
              </button>
              <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="sk-display"
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: page >= totalPages ? 0.4 : 1
                }}
              >
                NEXT →
              </button>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
