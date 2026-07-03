import React from 'react';

function Side({ side, athlete, total, status, label, winner, matchHasResult, nj }) {
  const isBlue = side === 'blue';
  const hasScore  = total != null;
  const hasStatus = !!status;

  // Pre-result: text on OUTER edge, bib chip on INNER edge (next to VS).
  // After result: text on INNER edge, score (or status) on OUTER edge.
  // Use the match-level `matchHasResult` so BOTH sides flip together --
  // otherwise a DNF loser flips while the no-score winner stays pre-result.
  const flexDirection = matchHasResult
    ? (isBlue ? 'row-reverse' : 'row')
    : (isBlue ? 'row' : 'row-reverse');

  const textAlign = matchHasResult
    ? (isBlue ? 'right' : 'left')   // text now near VS center
    : (isBlue ? 'left' : 'right');  // text near outer edge

  // Pull the inner edge inward so the name/club text doesn't crowd the VS circle.
  const padding = matchHasResult
    ? (isBlue ? '16px 60px 16px 24px' : '16px 24px 16px 60px')
    : '16px 24px';

  const bibNum = athlete?.bib_number;
  const bibText = (bibNum != null && bibNum !== '') ? `#${bibNum}` : '';

  let chipContent;
  let chipFontSize;
  let chipHidden = false;
  if (hasScore) {
    chipContent  = Math.round(Number(total));
    chipFontSize = 44;
  } else if (hasStatus) {
    chipContent  = status;
    chipFontSize = 38;
  } else if (matchHasResult) {
    // Match has a result but this side has neither score nor status
    // (e.g., winner advancing on opponent's DNF). Render invisible chip
    // to preserve layout symmetry without showing the bib.
    chipContent  = '';
    chipFontSize = 28;
    chipHidden = true;
  } else {
    chipContent  = bibText || '–';
    chipFontSize = 28;
  }

  const winnerShadow = winner
    ? 'inset 0 0 0 6px #f5c518, 0 0 40px rgba(245, 197, 24, 0.7)'
    : 'none';

  const sideRadius = isBlue ? '14px 0 0 14px' : '0 14px 14px 0';

  return (
    <div style={{
      flex: 1,
      background: isBlue ? 'var(--gradient-blue)' : 'var(--gradient-red)',
      padding,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      minWidth: 360,
      flexDirection,
      borderRadius: sideRadius,
      boxShadow: winnerShadow,
      position: 'relative',
    }}>
      <div style={{ textAlign, minWidth: 0, flex: 1 }}>
        <div className="sk-display" style={{ fontSize: 11, letterSpacing: '0.15em', opacity: 0.85 }}>
          {label || (isBlue ? 'BLUE' : 'RED')}
          {!!nj && (
            <span className="sk-display" style={{
              marginLeft: 8, background: 'rgba(0,0,0,0.35)', color: '#f5c518',
              padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em'
            }}>NJ</span>
          )}
        </div>
        <div className="sk-display" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(athlete?.last_name || '').toUpperCase() || '—'}
        </div>
        {matchHasResult && bibText && (
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
        textAlign: 'center',
        visibility: chipHidden ? 'hidden' : 'visible',
      }}>
        {chipContent}
      </div>
    </div>
  );
}

export default function OverlayDualVS({ blueAthlete, redAthlete, blueTotal, redTotal, blueStatus, redStatus, blueLabel, redLabel, winnerSide, njBlue, njRed }) {
  const matchHasResult = (
    blueTotal != null || redTotal != null ||
    !!blueStatus || !!redStatus ||
    !!winnerSide
  );

  return (
    <div className="sk-fade-in" style={{
      display: 'inline-flex',
      borderRadius: 14,
      position: 'relative',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <Side
        side="blue"
        athlete={blueAthlete}
        total={blueTotal}
        status={blueStatus}
        label={blueLabel}
        winner={winnerSide === 'blue'}
        matchHasResult={matchHasResult}
        nj={njBlue}
      />
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
      <Side
        side="red"
        athlete={redAthlete}
        total={redTotal}
        status={redStatus}
        label={redLabel}
        winner={winnerSide === 'red'}
        matchHasResult={matchHasResult}
        nj={njRed}
      />
    </div>
  );
}
