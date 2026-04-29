import { useState, useRef, useEffect } from 'react'

export default function UsssAutocomplete({ endpoint, placeholder, value, onChange, onSelect, className }) {
  const [query, setQuery] = useState(value || '')
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  // Sync external value changes
  useEffect(() => { setQuery(value || '') }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doSearch = (term) => {
    if (!term || term.length < 2) { setResults([]); setShowDropdown(false); return }
    setLoading(true)
    // For "Last, First" format, search by last name
    let searchTerm = term
    const commaIdx = term.indexOf(',')
    if (commaIdx > 0) searchTerm = term.substring(0, commaIdx).trim()

    fetch(`/api/usss/${endpoint}?q=${encodeURIComponent(searchTerm)}`)
      .then(r => r.json())
      .then(data => {
        // If comma present, filter by first name
        let filtered = data
        if (commaIdx > 0) {
          const firstPart = term.substring(commaIdx + 1).trim().toLowerCase()
          if (firstPart) {
            filtered = data.filter(p => p.first_name.toLowerCase().startsWith(firstPart))
          }
        }
        setResults(filtered)
        setShowDropdown(filtered.length > 0)
      })
      .catch(() => { setResults([]); setShowDropdown(false) })
      .finally(() => setLoading(false))
  }

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    if (onChange) onChange(val)

    // Debounced search
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleSelect = (person) => {
    const formatted = `${person.last_name}, ${person.first_name}`
    setQuery(formatted)
    setShowDropdown(false)
    if (onChange) onChange(formatted)
    if (onSelect) onSelect(person)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        className={className || 'input'}
        placeholder={placeholder || 'Search by name...'}
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length) setShowDropdown(true) }}
      />
      {showDropdown && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-slate-500 text-xs">Searching...</div>}
          {results.map(p => (
            <button
              key={p.ussa_id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors border-b border-slate-700 last:border-0"
              onClick={() => handleSelect(p)}
            >
              <div className="flex items-center justify-between">
                <span className="text-white text-sm font-medium">{p.last_name}, {p.first_name}</span>
                <span className="text-slate-400 font-mono text-xs">{p.ussa_id}</span>
              </div>
              <div className="text-slate-500 text-xs mt-0.5">
                {p.division && <span className="mr-2">Div: {p.division}</span>}
                {p.gender && <span className="mr-2">{p.gender}</span>}
                {p.yob && <span className="mr-2">YOB: {p.yob}</span>}
                {p.club_name && <span>{p.club_name}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
