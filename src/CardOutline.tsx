import React, { useState } from 'react';
import { colors } from './theme';

/**
 * The line around a recognized person's card (browser build).
 *
 * `progress` (0 to 1) is how much of the outline is drawn: full while the person is in
 * view, then it drains around the card as their ten seconds run out. While `active`, a
 * brighter segment also travels round the card. People who ask for reduced motion get
 * the outline without the travelling segment.
 */
export function CardOutline({ width, height, radius, progress, active }: {
  width: number; height: number; radius: number; progress: number; active: boolean;
}) {
  const [still] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (width < 8 || height < 8) return null;
  const inset = 1.5;
  // pathLength makes the outline 100 units long whatever the card's size, so the dashes below are percentages.
  const shape = {
    x: inset, y: inset, width: width - inset * 2, height: height - inset * 2, rx: radius, ry: radius,
    fill: 'none', pathLength: 100,
  };
  const drawn = Math.max(0, Math.min(1, progress)) * 100;
  return <svg aria-hidden="true" data-testid="card-outline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
    style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
    <rect {...shape} stroke={colors.violetSoft} strokeWidth={2} />
    <rect {...shape} data-testid="card-outline-progress" stroke={colors.violet} strokeWidth={2.5} strokeLinecap="round"
      strokeDasharray={`${drawn} 100`} style={{ transition: still ? undefined : 'stroke-dasharray 0.25s linear' }} />
    {active && !still && <rect {...shape} data-testid="card-outline-orbit" stroke="#C9BBFF" strokeWidth={3.5} strokeLinecap="round"
      strokeDasharray="12 88" style={{ filter: 'drop-shadow(0 0 5px rgba(124,92,255,0.85))' }}>
      <animate attributeName="stroke-dashoffset" from="100" to="0" dur="2.6s" repeatCount="indefinite" />
    </rect>}
  </svg>;
}
