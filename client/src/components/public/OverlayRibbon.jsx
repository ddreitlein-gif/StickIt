import React from 'react';
import LiveDot from './LiveDot';

export default function OverlayRibbon({ meetName, eventLabel, roundLabel, live = true }) {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 14,
      padding: '10px 22px',
      background: 'linear-gradient(90deg, rgba(7,13,26,0.95) 0%, rgba(14,22,40,0.95) 100%)',
      border: '1px solid var(--border)',
      borderRadius: 999,
      backdropFilter: 'blur(8px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
    }}>
      {live && <LiveDot size={8} />}
      {meetName && (
        <span className="sk-display" style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.08em' }}>
          {meetName}
        </span>
      )}
      {eventLabel && (
        <>
          <span style={{ color: 'var(--fg-dim)' }}>·</span>
          <span className="sk-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.06em' }}>
            {eventLabel}
          </span>
        </>
      )}
      {roundLabel && (
        <>
          <span style={{ color: 'var(--fg-dim)' }}>·</span>
          <span className="sk-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', letterSpacing: '0.06em' }}>
            {roundLabel}
          </span>
        </>
      )}
    </div>
  );
}
