export default function FineTuneRow({
  value,
  onChange,
  min = 0,
  max = 10,
  step = 0.1,
  disabled = false,
  size = 'md',
  emptyHint = 'select score first',
  decimals = 1,
}) {
  const has = value !== null && value !== undefined
  const dec = decimals
  const round = (n) => parseFloat(n.toFixed(dec))
  const dec1 = () => onChange(round(Math.max(min, (value || 0) - step)))
  const inc1 = () => onChange(round(Math.min(max, (value || 0) + step)))

  const sizes = {
    sm: { btn: 56, font: 22, display: 38 },
    md: { btn: 64, font: 24, display: 48 },
    lg: { btn: 80, font: 28, display: 64 },
  }
  const s = sizes[size] || sizes.md

  return (
    <div className={`tablet-finetune ${(disabled || !has) ? 'is-disabled' : ''}`}>
      <button
        type="button"
        className="tablet-finetune-btn"
        onClick={dec1}
        style={{ height: s.btn, fontSize: s.font }}
      >
        −0.1
      </button>
      <div className="tablet-finetune-display" style={{ fontSize: s.display }}>
        {has ? value.toFixed(dec) : <span style={{ fontSize: 14, opacity: 0.5 }}>{emptyHint}</span>}
      </div>
      <button
        type="button"
        className="tablet-finetune-btn"
        onClick={inc1}
        style={{ height: s.btn, fontSize: s.font }}
      >
        +0.1
      </button>
    </div>
  )
}
