import React from 'react';

export default function BibChip({ bib, size = 'md' }) {
  const sizes = {
    sm: { padX: 6, padY: 2, font: 11, minW: 26 },
    md: { padX: 8, padY: 3, font: 13, minW: 32 },
    lg: { padX: 10, padY: 5, font: 16, minW: 42 }
  };
  const s = sizes[size] || sizes.md;
  return (
    <span
      className="sk-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${s.padY}px ${s.padX}px`,
        minWidth: s.minW,
        borderRadius: 6,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        color: 'var(--fg)',
        fontSize: s.font,
        fontWeight: 600,
        flexShrink: 0
      }}
    >
      {bib != null && bib !== '' ? bib : '–'}
    </span>
  );
}
