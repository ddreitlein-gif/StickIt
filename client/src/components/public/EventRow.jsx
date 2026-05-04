import React from 'react';
import { Link } from 'react-router-dom';
import StatusPill from './StatusPill';

const DISCIPLINE_LABEL = {
  mogul: 'Moguls',
  dual_mogul: 'Dual Moguls',
  aerials: 'Aerials'
};

const GENDER_LABEL = { M: 'Men', F: 'Women', X: 'Mixed' };

export default function EventRow({ event }) {
  const target = `/scoreboard/${event.short_code || event.id}`;
  const disc = DISCIPLINE_LABEL[event.discipline] || event.discipline || '';
  const gen = GENDER_LABEL[event.gender] || event.gender || '';
  const title = [gen, disc].filter(Boolean).join(' · ');

  return (
    <Link
      to={target}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--bg-elev)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 150ms'
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--red)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="sk-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {event.category && (
          <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginTop: 2 }}>
            {event.category}
          </div>
        )}
      </div>
      <StatusPill status={event.status} />
    </Link>
  );
}
