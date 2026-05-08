function zoneFor(value, zones) {
  if (!zones || zones.length === 0) return ''
  for (const z of zones) {
    if (value >= z.min && value <= z.max) return z.zone
  }
  return ''
}

function buildSteps(min, max, step) {
  const out = []
  const decimals = (step.toString().split('.')[1] || '').length
  for (let v = min; v <= max + 1e-9; v += step) {
    out.push(parseFloat(v.toFixed(decimals)))
  }
  return out
}

// Picks the index of the grid button closest to `value`. Returns -1 when no
// value is set or when the value is more than 0.26 away from every grid step
// (so a deliberately off-grid value won't accidentally highlight a far button).
function nearestAnchor(value, steps) {
  if (value === null || value === undefined || !steps.length) return -1
  let best = Infinity, idx = -1
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(value - steps[i])
    if (d < best) { best = d; idx = i }
  }
  return best <= 0.26 ? idx : -1
}

export default function ScoreButtonGrid({
  min,
  max,
  step = 0.5,
  cols,
  rowHeight = 52,
  fontSize = 18,
  zones = [],
  value,
  onChange,
  formatLabel = (v) => v.toFixed(1),
  // Optional: explicit list of values to render. When provided, `min/max/step`
  // are ignored. Use this for the slide-01 air score grid which has uneven
  // stepping (1.0 increments 0–5 then 0.5 increments 6–10).
  values,
}) {
  const steps = Array.isArray(values) && values.length > 0 ? values : buildSteps(min, max, step)
  const anchorIdx = nearestAnchor(value, steps)
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {steps.map((v, i) => {
        const z = zoneFor(v, zones)
        const selected = i === anchorIdx
        return (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={`tablet-score-btn ${z ? `zone-${z}` : ''} ${selected ? 'is-selected' : ''}`}
            style={{ height: rowHeight, fontSize }}
          >
            {formatLabel(v)}
          </button>
        )
      })}
    </div>
  )
}

// Pre-built zone presets for the three score grids the design uses.
export const ZONES_AIR = [
  { min: 0,   max: 3.99, zone: 'po' },
  { min: 4,   max: 5.99, zone: 'av' },
  { min: 6,   max: 8.49, zone: 'gd' },
  { min: 8.5, max: 10,   zone: 'ex' },
]

export const ZONES_TL = [
  { min: 0,    max: 4,     zone: 'po' },
  { min: 4.5,  max: 8,     zone: 'mg' },
  { min: 8.5,  max: 12,    zone: 'av' },
  { min: 12.5, max: 16,    zone: 'gd' },
  { min: 16.5, max: 20,    zone: 'ex' },
]

export const ZONES_COMP_5 = [
  { min: 0,    max: 1.99, zone: 'po' },
  { min: 2,    max: 2.99, zone: 'av' },
  { min: 3,    max: 4.49, zone: 'gd' },
  { min: 4.5,  max: 5,    zone: 'ex' },
]

// Slide-01 air-judge mixed-step values. Exported so JudgeTablet can pass it
// via the `values` prop without duplicating the literal.
export const VALUES_AIR_15 = [
  0.0, 1.0, 2.0, 3.0, 4.0, 5.0,
  6.0, 6.5, 7.0, 7.5, 8.0, 8.5,
  9.0, 9.5, 10.0,
]
