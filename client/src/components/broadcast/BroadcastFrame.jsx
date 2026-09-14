import React, { useLayoutEffect, useRef } from 'react';
import './broadcast.css';

// StickIt v2.6.00 -- Broadcast Board stage: a fixed 1920x1080 canvas scaled
// to the viewport (letterboxed on the gradient ground), a 148px navy header
// band with the 10px red stripe, and a 70px navy footer band. Non-interactive
// by construction: the root sets pointer-events:none + user-select:none in
// broadcast.css and nothing here registers a handler.
//
// Props:
//   meetName, title, phaseLabel, badge ('OFFICIAL' | 'UNOFFICIAL' | null)
//   caption      footer caption text (already uppercase-styled by CSS)
//   legend       true -> blue / red course legend in the footer (duals)
//   pageCount, pageIndex -> the rotation bars
//   pageKey      changes whenever the visible page changes (drives the fade)
export default function BroadcastFrame({
  meetName, title, phaseLabel, badge = null,
  caption, legend = false, pageCount = 1, pageIndex = 0, pageKey = 'p',
  children,
}) {
  const stageRef = useRef(null);

  // Scale the stage to fit the viewport. At 1920x1080 this is exactly 1.0.
  useLayoutEffect(() => {
    const apply = () => {
      if (!stageRef.current) return;
      const sx = window.innerWidth / 1920;
      const sy = window.innerHeight / 1080;
      const s = Math.min(sx, sy) || 1;
      stageRef.current.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    apply();
    window.addEventListener('resize', apply);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply);
      ro.observe(document.documentElement);
    }
    return () => {
      window.removeEventListener('resize', apply);
      if (ro) ro.disconnect();
    };
  }, []);

  const bars = Math.max(1, pageCount);
  const activeBar = bars > 0 ? ((pageIndex % bars) + bars) % bars : 0;

  return (
    <div className="sk-broadcast" data-testid="broadcast-root">
      <div className="bb-stage" ref={stageRef} data-testid="broadcast-stage">
        <div className="bb-header">
          <div className="bb-header-left">
            <div className="bb-eyebrow" data-testid="bb-meet">{meetName || ' '}</div>
            <div className="bb-title bb-cond" data-testid="bb-title">{title || ' '}</div>
          </div>
          <div className="bb-header-right">
            {phaseLabel ? <div className="bb-phase" data-testid="bb-phase">{phaseLabel}</div> : null}
            {badge ? (
              <div className={`bb-badge${badge === 'OFFICIAL' ? ' official' : ''}`} data-testid="bb-badge">{badge}</div>
            ) : null}
          </div>
        </div>

        <div className="bb-content">
          <div className="bb-page" key={pageKey} data-testid="bb-page">
            {children}
          </div>
        </div>

        <div className="bb-footer">
          <div className="bb-caption" data-testid="bb-caption">{caption || ''}</div>
          <div className="bb-footer-right">
            {legend ? (
              <div className="bb-legend" data-testid="bb-legend">
                <span className="bb-legend-swatch" style={{ background: 'var(--bb-blue)' }} />
                <span>Blue course</span>
                <span className="bb-legend-swatch" style={{ background: 'var(--bb-red)', marginLeft: 12 }} />
                <span>Red course</span>
              </div>
            ) : null}
            <div className="bb-bars" data-testid="bb-bars">
              {Array.from({ length: bars }, (_, i) => (
                <span key={i} className={`bb-bar${i === activeBar ? ' on' : ''}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
