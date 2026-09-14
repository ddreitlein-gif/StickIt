import React from 'react';

// StickIt v2.6.00 -- Broadcast Board "Latest Result" hero: the most recently
// published run of the current round. Bib chip, name at 92px, TIME, TOTAL
// and a navy POSITION block reading "NOW 2ND" (the athlete's rank in the
// combined standings). UNOFFICIAL is stated in the footer caption.
export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  const s = ['TH', 'ST', 'ND', 'RD'];
  const m = v % 100;
  return `${v}${s[(m - 20) % 10] || s[m] || s[0]}`;
}

export default function LatestResult({ bib, name, time, total, rank, showTime = true }) {
  return (
    <div className="bb-panel bb-hero" data-testid="bb-latest">
      <div style={{ minWidth: 0 }}>
        <div className="bb-hero-label">Latest result</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, minWidth: 0 }}>
          <span className="bb-bibchip bb-num" style={{ height: 72, minWidth: 96, fontSize: 44 }}>{bib ?? ''}</span>
          <div className="bb-hero-name" data-testid="bb-latest-name">{name}</div>
        </div>
      </div>
      <div className="bb-hero-stats">
        {showTime ? (
          <div className="bb-stat">
            <div className="bb-stat-k">Time</div>
            <div className="bb-stat-v bb-num" data-testid="bb-latest-time">{time != null ? time : ''}</div>
          </div>
        ) : null}
        <div className="bb-stat">
          <div className="bb-stat-k">Total</div>
          <div className="bb-stat-v bb-num" data-testid="bb-latest-total">{total != null ? total : ''}</div>
        </div>
        <div className="bb-pos">
          <div className="bb-pos-k">Position</div>
          <div className="bb-pos-v" data-testid="bb-latest-pos">{rank ? `NOW ${ordinal(rank)}` : ''}</div>
        </div>
      </div>
    </div>
  );
}
