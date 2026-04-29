import { useState } from 'react'

export default function useHighContrast() {
  const [hc, setHc] = useState(() => localStorage.getItem('stickit-high-contrast') === '1')
  const toggle = () => {
    setHc(prev => {
      const next = !prev
      localStorage.setItem('stickit-high-contrast', next ? '1' : '0')
      return next
    })
  }
  return [hc, toggle]
}
