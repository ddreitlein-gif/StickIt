import React from 'react';
import { RankChip } from './LeaderRows';

// StickIt v2.6.00 -- Broadcast Board Final Placings.
//   Podium: 2 / 1 / 3 blocks at 248 / 340 / 206px with the medal color as a
//   14px top rule, place numeral and total inside, name and bib above (team
//   under the name). Dual events pass no totals (rank, bib, name only).
//   PlacesTable: places 4-10 (and later pages) in a four-column table —
//   rank, bib, name, total; no run time. Dual events omit the total column.
//
// entries: [{ key, rank, bib, name, team, total, status }]
const HEIGHTS = { 1: 340, 2: 248, 3: 206 };

export function Podium({ entries, showTotal = true }) {
  const byRank = (r) => entries.find(e => Number(e.rank) === r) || null;
  const order = [2, 1, 3];
  return (
    <div className="bb-podium" data-testid="bb-podium">
      {order.map(place => {
        const e = byRank(place);
        return (
          <div className="bb-pod" key={place} data-testid={`bb-pod-${place}`}>
            <div className="bb-pod-name">{e ? e.name : ''}</div>
            <div className="bb-pod-sub">{e ? [e.bib != null && e.bib !== '' ? `Bib ${e.bib}` : null, e.team || null].filter(Boolean).join(' · ') : ' '}</div>
            <div className={`bb-pod-block m${place}`} style={{ height: HEIGHTS[place] }}>
              <div className="bb-pod-place">{place}</div>
              {showTotal && e && e.total != null ? <div className="bb-pod-total bb-num">{e.total}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PlacesTable({ entries, showTotal = true, heading = 'Place' }) {
  const fromPlace = entries.length ? Number(entries[0].rank) : 0;
  const toPlace = entries.length ? Number(entries[entries.length - 1].rank) : 0;
  return (
    <div className={`bb-panel bb-places${showTotal ? '' : ' nototal'}`} data-testid="bb-places">
      <div className="bb-rows">
        <div className="bb-row head">
          <span>{heading}</span>
          <span>Bib</span>
          <span>Places {fromPlace}{toPlace > fromPlace ? ` ${'\u2013'} ${toPlace}` : ''}</span>
          {showTotal ? <span style={{ textAlign: 'right' }}>Total</span> : null}
        </div>
        {entries.length === 0 ? (
          <div className="bb-empty">No further places</div>
        ) : entries.map(e => (
          <div className="bb-row" key={e.key} data-testid="bb-place-row">
            <span><RankChip rank={e.rank} /></span>
            <span className="bb-bib bb-num">{e.bib ?? ''}</span>
            <span className="bb-name">{e.name}</span>
            {showTotal ? (
              e.status
                ? <span className="bb-status">{e.status}</span>
                : <span className="bb-total bb-num" style={{ fontSize: 44 }}>{e.total != null ? e.total : ''}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
