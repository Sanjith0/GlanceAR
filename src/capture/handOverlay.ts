import type { HandAssessment, HandSample } from '../handGesture';

const chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [17, 0]];
/** Video and canvas share native dimensions, object-fit:contain, and the same mirror transform. */
export function drawHandOverlays(canvas: HTMLCanvasElement, hands: HandSample[], assessments: HandAssessment[]) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  hands.forEach((hand, index) => {
    if (hand.landmarks.length !== 21 || !hand.landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    const points = hand.landmarks.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
    const accepted = assessments[index]?.valid;
    const accent = accepted ? '#38E59A' : '#9CC9FF';
    context.lineWidth = Math.max(2, canvas.width / 350);
    for (const chain of chains) {
      context.beginPath();
      chain.forEach((point, i) => i ? context.lineTo(points[point].x, points[point].y) : context.moveTo(points[point].x, points[point].y));
      context.strokeStyle = accent; context.stroke();
    }
    points.forEach((point, i) => {
      const tip = [4, 8, 12].includes(i);
      context.beginPath(); context.arc(point.x, point.y, (tip ? 7 : 3) * Math.max(1, canvas.width / 960), 0, Math.PI * 2);
      context.fillStyle = tip ? accent : '#FFFFFF'; context.fill();
      if (tip) { context.strokeStyle = '#102B24'; context.lineWidth = 2; context.stroke(); }
    });
    // The halo follows the detected hand, never a decorative/static guide.
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    context.beginPath();
    context.ellipse((left + right) / 2, (top + bottom) / 2, (right - left) / 2 + 16, (bottom - top) / 2 + 16, 0, 0, Math.PI * 2);
    context.strokeStyle = accent; context.lineWidth = accepted ? 4 : 2; context.stroke();
  });
}
