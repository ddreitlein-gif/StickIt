import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import PublicLayout from '../components/public/PublicLayout';
import LiveDot from '../components/public/LiveDot';

export default function Home() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
  }, []);

  return (
    <PublicLayout>
      <div style={{
        minHeight: '100vh',
        background: 'var(--gradient-bg)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/images/homepage-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.18,
          mixBlendMode: 'screen',
          pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 240,
          background: 'linear-gradient(180deg, transparent 0%, rgba(230,57,70,0.18) 100%)',
          pointerEvents: 'none'
        }} />

        <div style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 560,
          margin: '0 auto',
          padding: '60px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minHeight: '100vh'
        }}>
          <div style={{ marginBottom: 16, marginTop: 40 }}>
            <img
              src="/images/stickit-logo-home.png"
              alt="StickIt"
              style={{ maxWidth: 320, width: '100%', display: 'block', filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.5))' }}
            />
          </div>

          <p className="sk-display" style={{
            fontSize: 14,
            letterSpacing: '0.3em',
            color: 'var(--fg-muted)',
            marginBottom: 48,
            textTransform: 'uppercase'
          }}>
            Freestyle Scoring
          </p>

          <Link
            to="/livescores"
            style={{
              width: '100%',
              maxWidth: 380,
              padding: '20px 24px',
              background: 'var(--gradient-red)',
              borderRadius: 14,
              border: 'none',
              color: '#fff',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              boxShadow: '0 8px 24px rgba(230,57,70,0.35)',
              transition: 'transform 150ms ease',
              marginBottom: 40
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            <LiveDot size={10} color="#fff" />
            <div style={{ flex: 1 }}>
              <div className="sk-display" style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.05em' }}>
                Live Scores
              </div>
              <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                View results and competition standings
              </div>
            </div>
            <span style={{ fontSize: 22 }}>→</span>
          </Link>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 380, marginBottom: 24 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="sk-display" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--fg-dim)' }}>
              LOGIN REQUIRED
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 380, marginBottom: 12 }}>
            <SecondaryButton to="/dashboard" label="Officials" icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            } />
            <SecondaryButton to="/admin" label="Admin" icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            } />
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ textAlign: 'center', color: 'var(--fg-dim)', fontSize: 11 }}>
            <p style={{ margin: 0 }}>© Rocky Mountain Freestyle</p>
            {version && (
              <p className="sk-mono" style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.7 }}>
                {version}
              </p>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

function SecondaryButton({ to, label, icon }) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '20px 14px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        color: 'var(--fg)',
        textDecoration: 'none',
        transition: 'border-color 150ms, background 150ms'
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--red)';
        e.currentTarget.style.background = 'var(--bg-elev)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background = 'var(--bg-panel)';
      }}
    >
      <span style={{ color: 'var(--fg-muted)' }}>{icon}</span>
      <span className="sk-display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em' }}>
        {label}
      </span>
    </Link>
  );
}
