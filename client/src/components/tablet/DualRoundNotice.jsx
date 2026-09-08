// v2.5.06 -- Dual mogul round notation for the judge + Head Judge tablets.
//
// Display only. Both pieces are fed by the server (server/dual/runOrder.js
// via GET /dual/active-match `round_label`, GET /dual rows `round_label`, and
// GET /dual/round-state `ended_round_label`); nothing here touches scoring,
// placement, or the run order.
//
//   <DualRoundLabel label="Female Round of 32" />
//     -- the strip at the top of every match card (score entry screen).
//   <DualRoundEndedPanel label="End of Round of 32 for Females" />
//     -- the large amber notice on the waiting screens once a round has
//        ended and before the next match starts (through the Round of 8,
//        then "End of Semi-Finals"; nothing after the finals).
//
// Styled with the tablet CSS variables so it reads the same on the judge
// tablet (var-styled) and the HJ tablet (Tailwind slate) and in HC mode.

export function DualRoundLabel({ label, size = 'lg' }) {
  if (!label) return null
  const big = size === 'lg'
  return (
    <div
      data-testid="dual-round-label"
      className="text-center rounded-lg"
      style={{
        background: 'rgba(14,144,229,0.14)',
        border: '1.5px solid var(--tablet-blue2)',
        color: '#fff',
        fontWeight: 800,
        letterSpacing: 0.5,
        fontSize: big ? 22 : 16,
        padding: big ? '8px 12px' : '5px 10px',
        marginBottom: big ? 12 : 8,
      }}
    >
      {label}
    </div>
  )
}

export function DualRoundEndedPanel({ label }) {
  if (!label) return null
  return (
    <div
      data-testid="dual-round-ended"
      className="text-center rounded-2xl"
      style={{
        background: 'rgba(245,158,11,0.18)',
        border: '3px solid var(--tablet-amber2)',
        padding: '26px 20px',
        marginBottom: 16,
      }}
    >
      <div className="tablet-display" style={{ fontSize: 44, lineHeight: 1.05, color: 'var(--tablet-amber2)', letterSpacing: 1 }}>
        {label}
      </div>
      <div className="text-base mt-3" style={{ color: 'var(--tablet-dim)' }}>
        Waiting for the next round to start
      </div>
    </div>
  )
}
