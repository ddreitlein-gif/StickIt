import React from 'react';

export default function DivisionFilter({ divisions, value, onChange }) {
  const items = ['', ...(divisions || [])];
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '4px 0',
        scrollbarWidth: 'none'
      }}
    >
      {items.map(d => {
        const active = (d || '') === (value || '');
        const label = d || 'All Divisions';
        return (
          <button
            key={d || 'all'}
            onClick={() => onChange(d)}
            className="sk-display"
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: active ? '1px solid var(--red)' : '1px solid var(--border)',
              background: active ? 'var(--red)' : 'var(--bg-panel)',
              color: active ? '#fff' : 'var(--fg-muted)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
