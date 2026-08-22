import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './fonts.js'  // v2.0.00 (FR-18) — self-hosted fonts, no CDN

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
