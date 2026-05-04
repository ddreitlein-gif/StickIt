import React from 'react';

export default function RankChip({ rank, size = 32 }) {
  const r = Number(rank);
  let bg, fg, border;
  if (r === 1) {
    bg = 'var(--gold)';
    fg = '#1a1300';
    border = 'transparent';
  } else if (r === 2) {
    bg = 'var(--silver)';
    fg = '#1a1d22';
    border = 'transparent';
  } else if (r === 3) {
    bg = 'var(--bronze)';
    fg = '#1a0d04';
    border = 'transparent';
  } else {
    bg = 'var(--bg-elev)';
    fg = 'var(--fg)';
    border = 'var(--border)';
  }

  return (
    <span
      className="sk-display"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 8,
        background: bg,
        color: fg,
        fontSize: size >= 32 ? 16 : 13,
        fontWeight: 800,
        border: `1px solid ${border}`,
        flexShrink: 0
      }}
    >
      {r > 0 ? r : '–'}
    </span>
  );
}
