import React from 'react';

// StickIt v2.6.00 -- Broadcast Board "Still To Come": the next three starters
// at equal weight (bib chip, name, team). Deliberately not a hero panel.
// athletes: [{ id, bib_number, first_name, last_name, club }]
export default function StillToCome({ athletes, heading = 'Still To Come', emptyText = 'Round complete' }) {
  const list = (athletes || []).slice(0, 3);
  return (
    <div className="bb-panel" data-testid="bb-still-to-come">
      <div className="bb-panel-head"><span>{heading}</span></div>
      {list.length === 0 ? (
        <div className="bb-empty">{emptyText}</div>
      ) : list.map(a => (
        <div className="bb-stc-row" key={a.id || `${a.bib_number}-${a.last_name}`} data-testid="bb-stc-row">
          <span className="bb-bibchip bb-num">{a.bib_number ?? ''}</span>
          <span style={{ minWidth: 0 }}>
            <div className="bb-stc-name">{[a.first_name, a.last_name].filter(Boolean).join(' ')}</div>
            {a.club ? <div className="bb-stc-team">{a.club}</div> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
