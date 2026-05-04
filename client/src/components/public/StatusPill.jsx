import React from 'react';
import LiveDot from './LiveDot';

export default function StatusPill({ status, label }) {
  // status: 'active' | 'complete' | 'setup' | 'final' | 'live' | 'upcoming'
  const norm = (status || '').toLowerCase();
  const isLive = norm === 'active' || norm === 'live';
  const isFinal = norm === 'complete' || norm === 'final';

  let bg, fg, text;
  if (isLive) {
    bg = 'var(--red)';
    fg = '#fff';
    text = label || 'LIVE';
  } else if (isFinal) {
    bg = 'var(--blue)';
    fg = '#fff';
    text = label || 'FINAL';
  } else {
    bg = 'var(--bg-elev)';
    fg = 'var(--fg-muted)';
    text = label || 'UPCOMING';
  }

  return (
    <span
      className="sk-display"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        border: isLive || isFinal ? 'none' : '1px solid var(--border)'
      }}
    >
      {isLive && <LiveDot size={6} color="#fff" />}
      {text}
    </span>
  );
}
