import React from 'react';

// StickIt v2.6.00 -- Broadcast Board meet logo panel. Shows the meet's event
// logo centered and scaled to fit (never upscaled beyond its natural size,
// never stretched) with at least 24px of padding; a bottom (sponsor) logo,
// when uploaded, sits beneath at up to half the panel height. The images
// come from the v2.6.00 public image endpoints in server/routes/pdf.js.
// Render nothing when neither logo exists (the caller omits the panel).
export default function MeetLogoPanel({ meetId, hasLogo, hasBottomLogo, cacheKey = '' }) {
  if (!meetId || (!hasLogo && !hasBottomLogo)) return null;
  const q = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : '';
  return (
    <div className="bb-panel bb-logo-panel" data-testid="bb-logo-panel">
      {hasLogo ? (
        <img
          src={`/api/pdf/logo/${meetId}/image${q}`}
          alt=""
          data-testid="bb-logo-img"
          style={{ maxHeight: hasBottomLogo ? '50%' : '100%', flex: '0 1 auto', minHeight: 0 }}
        />
      ) : null}
      {hasBottomLogo ? (
        <img
          src={`/api/pdf/bottom-logo/${meetId}/image${q}`}
          alt=""
          data-testid="bb-bottom-logo-img"
          style={{ maxHeight: hasLogo ? '40%' : '50%', flex: '0 1 auto', minHeight: 0 }}
        />
      ) : null}
    </div>
  );
}
