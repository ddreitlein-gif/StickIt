import React from 'react';

// StickIt v2.6.00 -- Broadcast Board leader rows. Exactly five fields per
// row: rank, bib, name, run time, total. No component scores, no judge
// breakdowns, no flags, no team name. Medal color on the rank chip for 1-3
// only; ranks 4+ are plain navy numerals.
//
// rows: [{ key, rank, bib, name, time, total, status, highlight }]
//   time / total are display strings (already formatted) or null for blank.
//   status (DNF/DNS/DSQ) replaces the total when present (Final Placings
//   only; the leader pages never pass flagged rows).
// showTime: false hides the time column values (aerials) but keeps the grid.
export function fmtScore(n) {
  if (n == null || n === '' || isNaN(Number(n))) return null;
  return Number(n).toFixed(2);
}

export function RankChip({ rank, noMedal = false }) {
  const r = Number(rank);
  const medal = noMedal ? '' : (r === 1 ? ' m1' : r === 2 ? ' m2' : r === 3 ? ' m3' : '');
  return <span className={`bb-rank${medal}`} data-testid="bb-rank">{r > 0 ? r : ''}</span>;
}

export default function LeaderRows({ rows, heading = 'Leaders', rankLabel = 'Rank', showTime = true, emptyText = 'No results yet' }) {
  return (
    <div className="bb-panel" data-testid="bb-leaders">
      <div className="bb-rows">
        <div className="bb-row head">
          <span>{rankLabel}</span>
          <span>Bib</span>
          <span>{heading}</span>
          <span style={{ textAlign: 'right' }}>{showTime ? 'Time' : ''}</span>
          <span style={{ textAlign: 'right' }}>Total</span>
        </div>
        {rows.length === 0 ? (
          <div className="bb-empty">{emptyText}</div>
        ) : rows.map(r => (
          <div className={`bb-row${r.highlight ? ' hl' : ''}`} key={r.key} data-testid="bb-leader-row">
            <span><RankChip rank={r.rank} noMedal={!!r.noMedal} /></span>
            <span className="bb-bib bb-num">{r.bib ?? ''}</span>
            <span className="bb-name">{r.name}</span>
            <span className="bb-time bb-num">{showTime && r.time != null ? r.time : ''}</span>
            {r.status
              ? <span className="bb-status">{r.status}</span>
              : <span className="bb-total bb-num">{r.total != null ? r.total : ''}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
