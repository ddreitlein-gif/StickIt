import React from 'react';
import EventRow from './EventRow';
import LiveDot from './LiveDot';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function MeetPanel({ meet, expanded, onToggle }) {
  const events = meet.events || [];
  const hasLive = events.some(e => e.status === 'active');
  const eventCount = events.length;

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        borderRadius: 14,
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 20px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {hasLive && <LiveDot size={8} />}
            <div className="sk-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>
              {meet.name}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {[fmtDate(meet.start_date), meet.location].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>{eventCount} {eventCount === 1 ? 'event' : 'events'}</span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 12, transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms' }}>▶</span>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8 }}>
          {events.length === 0 && (
            <div style={{ color: 'var(--fg-dim)', fontSize: 13, padding: 12 }}>No events</div>
          )}
          {events.map(ev => <EventRow key={ev.id} event={ev} />)}
        </div>
      )}
    </div>
  );
}
