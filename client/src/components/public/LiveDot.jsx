import React from 'react';

export default function LiveDot({ size = 8, color = 'var(--red)' }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        width: size,
        height: size,
        verticalAlign: 'middle'
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          background: color,
          animation: 'sk-pulse 1.6s ease-in-out infinite'
        }}
      />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          background: color
        }}
      />
    </span>
  );
}
