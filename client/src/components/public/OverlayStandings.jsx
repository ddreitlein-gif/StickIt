import React from 'react';

function fmt2(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(2);
}

const RANK_BG = { 1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)' };

function Row({ rank, bib, lastName, firstName, total, status }) {
  const bg = RANK_BG[rank];
  const isPodium = !!bg;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '10px 14px',
      background: isPodium ? bg : 'rgba(255,255,255,0.04)',
      color: isPodium ? '#1a1300' : '#fff',
      borderRadius: 10,
      border: isPodium ? 'none' : '1px solid rgba(255,255,255,0.08)'
    }}>
      <div className="sk-display" style={{
        fontSize: 22,
        fontWeight: 800,
        minWidth: 36,
        textAlign: 'center'
      }}>
        {rank}
      </div>
      <div className="sk-mono" style={{
        fontSize: 14,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 6,
        background: isPodium ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.08)',
        minWidth: 36,
        textAlign: 'center'
      }}>
        {bib != null && bib !== '' ? bib : '–'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sk-display" style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(lastName || '').toUpperCase()}{firstName ? `, ${firstName}` : ''}
        </div>
      </div>
      <div className="sk-mono" style={{ fontSize: 20, fontWeight: 700, minWidth: 90, textAlign: 'right' }}>
        {status || fmt2(total)}
      </div>
    </div>
  );
}

export default function OverlayStandings({ rows, title = 'STANDINGS' }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="sk-fade-in" style={{
      background: 'rgba(7,13,26,0.92)',
      backdropFilter: 'blur(10px)',
      padding: 18,
      borderRadius: 14,
      border: '1px solid rgba(255,255,255,0.1)',
      minWidth: 460,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <div className="sk-display" style={{
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: '0.2em',
        color: 'var(--red)',
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((r, i) => (
          <Row
            key={r.id || i}
            rank={r.rank || (i + 1)}
            bib={r.bib_number}
            lastName={r.last_name}
            firstName={r.first_name}
            total={r.total_score}
            status={r.run_status && ['DNS', 'DNF', 'DSQ'].includes(r.run_status) ? r.run_status : null}
          />
        ))}
      </div>
    </div>
  );
}
