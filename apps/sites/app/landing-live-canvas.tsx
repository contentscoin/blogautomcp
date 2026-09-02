'use client';

import { useEffect, useRef } from 'react';

type Point = { x: number; y: number; radius: number; color: string; phase: number };

const pointSeeds = [
  [0.06, 0.18, 3.4, '#3157ff', 0.2],
  [0.22, 0.76, 2.4, '#c8f135', 1.5],
  [0.42, 0.3, 2.8, '#8097ff', 2.3],
  [0.61, 0.82, 3.2, '#c8f135', 3.2],
  [0.74, 0.16, 2.6, '#3157ff', 4.1],
  [0.94, 0.58, 3.6, '#8097ff', 5.3],
] as const;

export default function LandingLiveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let running = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const points = (): Point[] => pointSeeds.map(([x, y, radius, color, phase]) => ({
      x: x * width,
      y: y * height,
      radius,
      color,
      phase,
    }));

    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      const nodes = points();
      const seconds = time / 1000;

      const glow = context.createRadialGradient(width * 0.72, height * 0.42, 0, width * 0.72, height * 0.42, width * 0.46);
      glow.addColorStop(0, 'rgba(49,87,255,.12)');
      glow.addColorStop(.52, 'rgba(200,241,53,.035)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      context.lineWidth = 1;
      for (let index = 0; index < nodes.length - 1; index += 1) {
        const from = nodes[index];
        const to = nodes[index + 1];
        const middleX = (from.x + to.x) / 2;
        const bend = index % 2 === 0 ? -height * .08 : height * .09;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.bezierCurveTo(middleX, from.y + bend, middleX, to.y - bend, to.x, to.y);
        context.strokeStyle = index % 2 === 0 ? 'rgba(49,87,255,.16)' : 'rgba(129,160,23,.16)';
        context.stroke();

        const progress = reducedMotion ? .55 : (seconds * .13 + index * .19) % 1;
        const inverse = 1 - progress;
        const particleX = inverse ** 3 * from.x + 3 * inverse ** 2 * progress * middleX + 3 * inverse * progress ** 2 * middleX + progress ** 3 * to.x;
        const particleY = inverse ** 3 * from.y + 3 * inverse ** 2 * progress * (from.y + bend) + 3 * inverse * progress ** 2 * (to.y - bend) + progress ** 3 * to.y;
        const particleGlow = context.createRadialGradient(particleX, particleY, 0, particleX, particleY, 13);
        particleGlow.addColorStop(0, index % 2 === 0 ? 'rgba(49,87,255,.65)' : 'rgba(172,211,31,.68)');
        particleGlow.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = particleGlow;
        context.beginPath();
        context.arc(particleX, particleY, 13, 0, Math.PI * 2);
        context.fill();
      }

      for (const node of nodes) {
        const pulse = reducedMotion ? 1 : 1 + Math.sin(seconds * 1.4 + node.phase) * .18;
        context.beginPath();
        context.arc(node.x, node.y, node.radius * 4.4 * pulse, 0, Math.PI * 2);
        context.fillStyle = `${node.color}18`;
        context.fill();
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = node.color;
        context.fill();
      }

      if (!reducedMotion && running) frame = window.requestAnimationFrame(draw);
    };

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw();
    });
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      running = entry.isIntersecting && document.visibilityState === 'visible';
      window.cancelAnimationFrame(frame);
      if (running) frame = window.requestAnimationFrame(draw);
    }, { threshold: .02 });

    resizeObserver.observe(parent);
    visibilityObserver.observe(canvas);
    resize();
    draw();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-live-canvas" aria-hidden="true" />;
}
