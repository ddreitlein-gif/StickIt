import React from 'react';

function Side({ side, athlete, total, status, label }) {
  const isBlue = side === 'blue';
  const hasScore  = total != null;
  const hasStatus = !!status;
  const showResult = hasScore || hasStatus;

  // Pre-result: text on OUTER edge, bib chip on INNER edge (next to VS).
  // After result: text on INNER edge, score (or status) on OUTER edge.
  const flexDirection = showResult
    ? (isBlue ? 'row-reverse' : 'row')
    : (isBlue ? 'row' : 'row-reverse');

  const textAlign = showResult
    ? (isBlue ? 'right' : 'left')   // text now near VS center
    : (isBlue ? 'left' : 'right');  // text near outer edge

  const bibNum = athlete?.bib_number;
  const bibText = (bibNum != null && bibNum !== '') ? `#${bibNum}` : '';

  let chipContent;
  let chipFontSize;
  if (hasScore) {
    chipContent  = Math.round(Number(total));
    chipFontSize = 44;
  } else if (hasStatus) {
    chipContent  = status;
    chipFontSize = 24;
  } else {
    chipContent  = bibText || '–';
    chipFontSize = 28;
  }

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
      flexDirection,
    }}>
      <div style={{ textAlign, minWidth: 0, flex: 1 }}>
        <div className="sk-display" style={{ fontSize: 11, letterSpacing: '0.15em', opacity: 0.85 }}>
          {label || (isBlue ? 'BLUE' : 'RED')}
        </div>
        <div className="sk-display" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(athlete?.last_name || '').toUpperCase() || '—'}
        </div>
        {showResult && bibText && (
          <div style={{ fontSize: 13, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {bibText}
          </div>
        )}
        {athlete?.club_name && (
          <div style={{ fontSize: 13, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {athlete.club_name}
          </div>
        )}
      </div>
      <div className="sk-mono" style={{
        fontSize: chipFontSize,
        fontWeight: 800,
        lineHeight: 1,
        background: 'rgba(0,0,0,0.25)',
        padding: '6px 16px',
        borderRadius: 10,
        minWidth: 90,
        textAlign: 'center'
      }}>
        {chipContent}
      </div>
    </div>
  );
}

export default function OverlayDualVS({ blueAthlete, redAthlete, blueTotal, redTotal, blueStatus, redStatus, blueLabel, redLabel }) {
  return (
    <div className="sk-fade-in" style={{
      display: 'inline-flex',
      borderRadius: 14,
      overflow: 'hidden',
      position: 'relative',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <Side side="blue" athlete={blueAthlete} total={blueTotal} status={blueStatus} label={blueLabel} />
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
      <Side side="red" athlete={redAthlete} total={redTotal} status={redStatus} label={redLabel} />
    </div>
  );
}
