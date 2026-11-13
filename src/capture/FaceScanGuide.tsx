import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { MESH_EDGES, SCAN_BINS, mirrorBin } from '../faceScan';

/**
 * What the guided face scan draws over the camera: a wireframe on the face, a circle
 * to sit inside, and a ring of ticks that turn green as the head moves around.
 * Browser-only (a canvas over the video); nothing here reads or stores a frame.
 */
export type ScanGuide = {
  /** The 68 landmarks of the face being scanned, in source video pixels. */
  landmarks: [number, number][] | null;
  /** Ring segments already covered, in image space (segment 0 points image-right). */
  bins: boolean[];
  /** 0 to 1: how much of the straight-on step is done. */
  centerProgress: number;
  /** The segment the head points at now, if any. */
  aim: number | null;
};

const TICKS = 64;
const GREEN = '#2BD687';

export function FaceScanGuide({ guide, source, view, mirrored }: {
  guide: ScanGuide;
  source: { width: number; height: number };
  view: { width: number; height: number };
  mirrored: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ guide, source, view, mirrored });
  useLayoutEffect(() => { latest.current = { guide, source, view, mirrored }; });

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0, alpha = 0;
    let shown: [number, number][] | null = null;
    const draw = () => {
      const { guide: now, source: video, view: size, mirrored: flipped } = latest.current;
      const width = size.width, height = size.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (width > 0 && height > 0) {
        const cx = width / 2, cy = height / 2, radius = Math.max(40, Math.min(width, height) / 2 - 30);

        // Dim everything outside the circle so the face is the subject.
        context.fillStyle = 'rgba(8,16,32,0.55)';
        context.beginPath();
        context.rect(0, 0, width, height);
        context.arc(cx, cy, radius, 0, Math.PI * 2, true);
        context.fill('evenodd');

        // The wireframe, eased toward the newest landmarks so it glides between detections.
        const target = now.landmarks && video.width > 0 ? now.landmarks.map(([x, y]): [number, number] => {
          const scale = Math.max(width / video.width, height / video.height);
          const px = (width - video.width * scale) / 2 + x * scale;
          return [flipped ? width - px : px, (height - video.height * scale) / 2 + y * scale];
        }) : null;
        if (target) {
          const previous = shown;
          shown = !previous || previous.length !== target.length || still ? target
            : previous.map(([x, y], i): [number, number] => [x + (target[i]![0] - x) * 0.35, y + (target[i]![1] - y) * 0.35]);
          alpha = still ? 1 : Math.min(1, alpha + 0.12);
        } else alpha = still ? 0 : Math.max(0, alpha - 0.08);
        if (shown && alpha > 0) {
          context.globalAlpha = alpha;
          context.lineWidth = 1;
          context.strokeStyle = 'rgba(150,225,255,0.8)';
          context.beginPath();
          for (const [a, b] of MESH_EDGES) {
            const from = shown[a], to = shown[b];
            if (!from || !to) continue;
            context.moveTo(from[0], from[1]);
            context.lineTo(to[0], to[1]);
          }
          context.stroke();
          context.fillStyle = 'rgba(255,255,255,0.95)';
          for (const [x, y] of shown) { context.beginPath(); context.arc(x, y, 1.4, 0, Math.PI * 2); context.fill(); }
          context.globalAlpha = 1;
        } else if (alpha <= 0) shown = null;

        // The circle: a faint outline, then the straight-on step's progress on top of it.
        const centred = now.centerProgress >= 1;
        context.lineWidth = 3;
        context.strokeStyle = 'rgba(255,255,255,0.28)';
        context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke();
        if (now.centerProgress > 0) {
          context.strokeStyle = centred ? 'rgba(43,214,135,0.9)' : 'rgba(143,182,255,0.98)';
          context.beginPath();
          context.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, now.centerProgress));
          context.stroke();
        }

        // The ring of ticks. Each belongs to one head direction and turns green once covered.
        context.lineCap = 'round';
        for (let i = 0; i < TICKS; i++) {
          const angle = (i / TICKS) * Math.PI * 2;
          const onScreen = Math.round(angle / (Math.PI * 2 / SCAN_BINS)) % SCAN_BINS;
          const bin = flipped ? mirrorBin(onScreen) : onScreen;
          const lit = Boolean(now.bins[bin]), aimed = centred && now.aim === bin;
          const length = lit ? 14 : aimed ? 12 : 8;
          context.lineWidth = lit ? 3 : 2;
          context.strokeStyle = lit ? GREEN : aimed ? 'rgba(255,255,255,0.98)' : centred ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)';
          context.beginPath();
          context.moveTo(cx + Math.cos(angle) * (radius + 6), cy + Math.sin(angle) * (radius + 6));
          context.lineTo(cx + Math.cos(angle) * (radius + 6 + length), cy + Math.sin(angle) * (radius + 6 + length));
          context.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} aria-hidden="true" data-testid="face-scan-guide"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
