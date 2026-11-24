import React, { useEffect, useRef } from 'react';

interface MatrixBackgroundProps {
  enabled: boolean;
  accentColor?: string;
}

export const MatrixBackground: React.FC<MatrixBackgroundProps> = ({
  enabled,
  accentColor = '#39FF88',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isSmallViewport = typeof window !== 'undefined' && window.innerWidth < 768;

    if (prefersReduced || isSmallViewport) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const glyphs = '01ROOHCLOUDSアイウエオカキクケコサシスセソタチツテト';
    const fontSize = 14;
    let columns = 0;
    let drops: number[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      columns = Math.floor(canvas.width / (fontSize * 1.4));
      drops = new Array(columns).fill(0).map(() => Math.floor(Math.random() * -40));
    };

    resize();
    window.addEventListener('resize', resize);

    let lastFrame = 0;
    const frameInterval = 68; // ~15fps restrained ambient motion for low CPU usage

    const draw = (time: number) => {
      animId = requestAnimationFrame(draw);
      if (time - lastFrame < frameInterval) return;
      lastFrame = time;

      ctx.fillStyle = 'rgba(3, 5, 5, 0.16)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = accentColor;
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = glyphs.charAt(Math.floor(Math.random() * glyphs.length));
        const x = i * fontSize * 1.4;
        const y = drops[i] * fontSize;
        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 1;
      }
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [enabled, accentColor]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.14] hidden md:block"
    />
  );
};
