import React from 'react';

function fmt2(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(2);
}
function fmt1(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(1);
}

function Stat({ label, value, delay }) {
  return (
    <div className="sk-fade-in" style={{
      animationDelay: `${delay}ms`,
      textAlign: 'center',
      padding: '12px 22px',
      borderRight: '1px solid rgba(255,255,255,0.1)'
    }}>
      <div className="sk-display" style={{ fontSize: 12, color: 'var(--fg-muted)', letterSpacing: '0.15em' }}>
        {label}
      </div>
      <div className="sk-mono" style={{ fontSize: 32, fontWeight: 700, color: '#fff', marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

export default function OverlayScoreReveal({ rank, turns, air, time, speed, total, status }) {
  const totalText = status || fmt2(total);
  const isStatus = !!status;

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'stretch',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      background: 'rgba(7,13,26,0.92)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.1)'
    }}>
      {rank > 0 && !isStatus && (
        <div className="sk-display" style={{
          background: rank === 1 ? 'var(--gold)' : rank === 2 ? 'var(--silver)' : rank === 3 ? 'var(--bronze)' : 'var(--bg-elev)',
          color: rank <= 3 ? '#1a1300' : '#fff',
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minWidth: 90
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', opacity: 0.7 }}>PLACE</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{rank}</div>
        </div>
      )}
      {!isStatus && (
        <>
          <Stat label="TURNS" value={fmt1(turns)} delay={50} />
          <Stat label="AIR" value={fmt2(air)} delay={130} />
          <Stat label="TIME" value={time != null && Number(time) === -1 ? 'NT' : fmt2(time)} delay={210} />
          <Stat label="SPEED" value={fmt2(speed)} delay={290} />
        </>
      )}
      <div className="sk-score-reveal" style={{
        background: isStatus ? 'var(--red-dim)' : 'var(--gradient-red)',
        color: '#fff',
        padding: '12px 32px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minWidth: 160,
        animationDelay: '380ms'
      }}>
        <div className="sk-display" style={{ fontSize: 12, letterSpacing: '0.15em', opacity: 0.8 }}>
          {isStatus ? 'STATUS' : 'TOTAL'}
        </div>
        <div className="sk-mono" style={{ fontSize: 48, fontWeight: 800, lineHeight: 1.05 }}>
          {totalText}
        </div>
      </div>
    </div>
  );
}
