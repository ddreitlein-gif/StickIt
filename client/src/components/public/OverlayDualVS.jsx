import React from 'react';

function fmt1(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(1);
}

function Side({ side, athlete, total, label }) {
  const isBlue = side === 'blue';
  return (
    <div style={{
      flex: 1,
      background: isBlue ? 'var(--gradient-blue)' : 'var(--gradient-red)',
      padding: '16px 24px',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      minWidth: 360,
      [isBlue ? 'flexDirection' : 'flexDirection']: isBlue ? 'row' : 'row-reverse'
    }}>
      <div style={{ textAlign: isBlue ? 'left' : 'right', minWidth: 0, flex: 1 }}>
        <div className="sk-display" style={{ fontSize: 11, letterSpacing: '0.15em', opacity: 0.85 }}>
          {label || (isBlue ? 'BLUE' : 'RED')}
        </div>
        <div className="sk-display" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(athlete?.last_name || '').toUpperCase() || '—'}
        </div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {athlete?.bib_number != null ? `#${athlete.bib_number}` : ''}
          {athlete?.club_name ? ` · ${athlete.club_name}` : ''}
        </div>
      </div>
      <div className="sk-mono" style={{
        fontSize: 44,
        fontWeight: 800,
        lineHeight: 1,
        background: 'rgba(0,0,0,0.25)',
        padding: '6px 16px',
        borderRadius: 10,
        minWidth: 90,
        textAlign: 'center'
      }}>
        {fmt1(total)}
      </div>
    </div>
  );
}

export default function OverlayDualVS({ blueAthlete, redAthlete, blueTotal, redTotal, blueLabel, redLabel }) {
  return (
    <div className="sk-fade-in" style={{
      display: 'inline-flex',
      borderRadius: 14,
      overflow: 'hidden',
      position: 'relative',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <Side side="blue" athlete={blueAthlete} total={blueTotal} label={blueLabel} />
      <div className="sk-display" style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 56,
        height: 56,
        borderRadius: 999,
        background: '#0a1224',
        color: '#fff',
        border: '3px solid #fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        fontWeight: 800,
        zIndex: 2
      }}>
        VS
      </div>
      <Side side="red" athlete={redAthlete} total={redTotal} label={redLabel} />
    </div>
  );
}
