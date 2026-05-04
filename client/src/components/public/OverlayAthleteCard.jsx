import React from 'react';

export default function OverlayAthleteCard({ bib, firstName, lastName, club, country }) {
  return (
    <div className="sk-fade-in" style={{
      display: 'inline-flex',
      alignItems: 'stretch',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <div className="sk-mono" style={{
        background: 'var(--gradient-red)',
        color: '#fff',
        padding: '20px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 56,
        fontWeight: 800,
        minWidth: 100
      }}>
        {bib != null && bib !== '' ? bib : '–'}
      </div>
      <div style={{
        background: 'rgba(7,13,26,0.92)',
        padding: '20px 28px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 380,
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        borderRight: '1px solid rgba(255,255,255,0.1)',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div className="sk-display" style={{ fontSize: 18, color: 'var(--fg-muted)', letterSpacing: '0.1em' }}>
          {(firstName || '').toUpperCase()}
        </div>
        <div className="sk-display" style={{ fontSize: 44, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '0.02em' }}>
          {(lastName || '').toUpperCase()}
        </div>
        {(club || country) && (
          <div style={{ fontSize: 14, color: 'var(--fg-dim)', marginTop: 6 }}>
            {[club, country].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
