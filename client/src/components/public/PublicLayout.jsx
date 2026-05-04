import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';

const PublicThemeContext = createContext({ sun: false, setSun: () => {} });
export const usePublicTheme = () => useContext(PublicThemeContext);

const FONT_LINK_ID = 'stickit-public-fonts';
const STYLE_ID = 'stickit-public-styles';

function injectFontsAndStyles() {
  if (typeof document === 'undefined') return;

  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Barlow+Condensed:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [data-stickit-public="1"] {
        --bg: #070d1a;
        --bg-panel: #0e1628;
        --bg-elev: #142036;
        --border: #1f2c44;
        --fg: #f5f7fb;
        --fg-muted: #94a3b8;
        --fg-dim: #64748b;
        --red: #e63946;
        --red-dim: #b02a36;
        --blue: #3b7dd8;
        --blue-dim: #2a5ca8;
        --gold: #f5c518;
        --silver: #c0c5cf;
        --bronze: #cd7f32;
        --gradient-red: linear-gradient(135deg, #e63946 0%, #b02a36 100%);
        --gradient-blue: linear-gradient(135deg, #3b7dd8 0%, #1e4d8f 100%);
        --gradient-bg: radial-gradient(ellipse at top, #0e1628 0%, #070d1a 70%);
      }
      [data-stickit-public="1"][data-theme="sun"] {
        --bg: #fafbfc;
        --bg-panel: #ffffff;
        --bg-elev: #f1f4f8;
        --border: #d6dde6;
        --fg: #0a1224;
        --fg-muted: #475569;
        --fg-dim: #64748b;
        --red: #c92433;
        --red-dim: #8c1721;
        --blue: #2363bf;
        --blue-dim: #18488f;
        --gold: #b8920d;
        --gradient-bg: linear-gradient(180deg, #ffffff 0%, #f1f4f8 100%);
      }
      [data-stickit-public="1"] {
        font-family: 'Inter Tight', system-ui, -apple-system, sans-serif;
        background: var(--bg);
        color: var(--fg);
        min-height: 100vh;
      }
      [data-stickit-public="1"] .sk-display {
        font-family: 'Barlow Condensed', 'Inter Tight', sans-serif;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      [data-stickit-public="1"] .sk-mono {
        font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
        font-variant-numeric: tabular-nums;
      }
      @keyframes sk-pulse {
        0%   { opacity: 1;   transform: scale(1); }
        50%  { opacity: 0.4; transform: scale(1.6); }
        100% { opacity: 1;   transform: scale(1); }
      }
      @keyframes sk-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes sk-score-reveal {
        0%   { opacity: 0; transform: scale(0.6); }
        100% { opacity: 1; transform: scale(1); }
      }
      .sk-score-reveal {
        animation: sk-score-reveal 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .sk-fade-in {
        animation: sk-fade-in 250ms ease-out both;
      }
    `;
    document.head.appendChild(style);
  }
}

export default function PublicLayout({ children, showSunToggle = true }) {
  const [sun, setSunState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('stickit.sunMode') === '1';
  });

  const setSun = (v) => {
    setSunState(v);
    if (typeof window !== 'undefined') {
      localStorage.setItem('stickit.sunMode', v ? '1' : '0');
    }
  };

  useEffect(() => {
    injectFontsAndStyles();
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.background = sun ? '#fafbfc' : '#070d1a';
    }
  }, [sun]);

  const ctx = useMemo(() => ({ sun, setSun }), [sun]);

  return (
    <PublicThemeContext.Provider value={ctx}>
      <div data-stickit-public="1" data-theme={sun ? 'sun' : 'dark'} style={{ minHeight: '100vh' }}>
        {showSunToggle && <SunModeToggle />}
        {children}
      </div>
    </PublicThemeContext.Provider>
  );
}

function SunModeToggle() {
  const { sun, setSun } = usePublicTheme();
  return (
    <button
      onClick={() => setSun(!sun)}
      aria-label={sun ? 'Switch to dark mode' : 'Switch to sun mode'}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 50,
        width: 40,
        height: 40,
        borderRadius: 999,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        color: 'var(--fg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 18,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}
    >
      {sun ? '🌙' : '☀'}
    </button>
  );
}
