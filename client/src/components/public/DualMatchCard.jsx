import React from 'react';
import LiveDot from './LiveDot';
import BibChip from './BibChip';

function fmt1(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '–';
  return Number(n).toFixed(1);
}

function SidePanel({ side, athlete, points, isWinner }) {
  const isBlue = side === 'blue';
  const grad = isBlue ? 'var(--gradient-blue)' : 'var(--gradient-red)';
  const total = points ? points.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const display = [athlete?.last_name, athlete?.first_name].filter(Boolean).join(', ') || '—';

  return (
    <div style={{
      flex: 1,
      padding: 16,
      background: grad,
      borderRadius: 12,
      color: '#fff',
      position: 'relative',
      minHeight: 220,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      opacity: athlete ? 1 : 0.5
    }}>
      {isWinner && (
        <div className="sk-display" style={{
          position: 'absolute',
          top: -10,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--gold)',
          color: '#1a1300',
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.1em'
        }}>
          WINNER
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BibChip bib={athlete?.bib_number} size="sm" />
        <div className="sk-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', opacity: 0.85 }}>
          {isBlue ? 'BLUE' : 'RED'}
        </div>
      </div>
      <div className="sk-display" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15 }}>
        {display}
      </div>
      {athlete?.club_name && (
        <div style={{ fontSize: 11, opacity: 0.8 }}>{athlete.club_name}</div>
      )}
      <div style={{ flex: 1 }} />
      <div>
        <div className="sk-display" style={{ fontSize: 9, letterSpacing: '0.15em', opacity: 0.75, marginBottom: 4 }}>JUDGES</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sk-mono" style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.25)',
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 700
            }}>
              {fmt1(points?.[i])}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div className="sk-display" style={{ fontSize: 10, letterSpacing: '0.15em', opacity: 0.75 }}>TOTAL</div>
        <div className="sk-mono" style={{ fontSize: 30, fontWeight: 800 }}>
          {fmt1(total)}
        </div>
      </div>
    </div>
  );
}

export default function DualMatchCard({ match, blueAthlete, redAthlete, bluePoints, redPoints, isLive, isFinal }) {
  const blueTotal = (bluePoints || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const redTotal = (redPoints || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const blueWinner = isFinal && blueTotal > redTotal;
  const redWinner = isFinal && redTotal > blueTotal;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="sk-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-muted)', letterSpacing: '0.1em' }}>
          {match?.round_label || 'MATCH'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isLive && <LiveDot size={6} />}
          <div className="sk-display" style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: isLive ? 'var(--red)' : isFinal ? 'var(--blue)' : 'var(--fg-dim)'
          }}>
            {isLive ? 'LIVE' : isFinal ? 'FINAL' : 'PENDING'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', position: 'relative' }}>
        <SidePanel side="blue" athlete={blueAthlete} points={bluePoints} isWinner={blueWinner} />
        <div className="sk-display" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2,
          width: 44,
          height: 44,
          borderRadius: 999,
          background: 'var(--bg-panel)',
          border: '2px solid var(--border)',
          color: 'var(--fg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 800
        }}>
          VS
        </div>
        <SidePanel side="red" athlete={redAthlete} points={redPoints} isWinner={redWinner} />
      </div>
    </div>
  );
}
