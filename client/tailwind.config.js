/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Bebas Neue', 'Impact', 'sans-serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        'inter-tight': ['Inter Tight', 'system-ui', 'sans-serif'],
        'barlow-condensed': ['Barlow Condensed', 'Inter Tight', 'sans-serif'],
      },
      colors: {
        mountain: {
          50:  '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7dc8fb',
          400: '#38aaf5',
          500: '#0e90e5',
          600: '#0272c4',
          700: '#035b9f',
          800: '#074e83',
          900: '#0c426d',
          950: '#082a48',
        },
        ice: {
          50:  '#f0fdfe',
          100: '#cdf8fc',
          200: '#9aeefa',
          300: '#58def5',
          400: '#22c7ea',
          500: '#09abc f',
          600: '#0a8dab',
          700: '#0f718b',
          800: '#165c71',
          900: '#174d5f',
          950: '#093240',
        },
        snow: '#f8fafc',
        slope: '#1e293b',
      },
    },
  },
  plugins: [],
}
