export default function StatusSquare({ active = false, className = '' }) {
  return (
    <span
      className={`tablet-status-square ${active ? 'is-green' : 'is-muted'} ${className}`}
      aria-hidden="true"
    />
  )
}
