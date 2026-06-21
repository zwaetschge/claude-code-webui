import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface PlumBackgroundProps {
  className?: string;
  enableCursorGlow?: boolean;
}

export function PlumBackground({ className, enableCursorGlow = true }: PlumBackgroundProps) {
  const glowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enableCursorGlow) return;

    const updateGlowPosition = () => {
      rafRef.current = 0;
      const glow = glowRef.current;
      if (!glow) return;

      const { x, y } = pointerRef.current;
      glow.style.transform = `translate3d(${x - 260}px, ${y - 90}px, 0) rotate(-14deg)`;
      glow.style.opacity = '1';
    };

    const handlePointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(updateGlowPosition);
    };

    const handlePointerEnter = () => {
      if (glowRef.current) glowRef.current.style.opacity = '1';
    };

    const handlePointerLeave = () => {
      if (glowRef.current) glowRef.current.style.opacity = '0';
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerenter', handlePointerEnter);
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerenter', handlePointerEnter);
      window.removeEventListener('pointerleave', handlePointerLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enableCursorGlow]);

  return (
    <div
      className={cn(
        'fixed inset-0 overflow-hidden pointer-events-none login-galaxy login-galaxy-plum',
        className
      )}
    >
      <div className="absolute inset-0 bg-background/70 backdrop-blur-[70px]" />
      <div className="login-galaxy-band login-galaxy-band-main" />
      <div className="login-galaxy-band login-galaxy-band-cross" />
      <div className="login-galaxy-haze" />

      {enableCursorGlow && (
        <div
          ref={glowRef}
          className="fixed pointer-events-none z-50 opacity-0"
          style={{
            width: '520px',
            height: '180px',
            background:
              'linear-gradient(100deg, transparent 0%, rgba(99, 244, 213, 0.26) 34%, rgba(116, 216, 255, 0.2) 56%, transparent 82%)',
            filter: 'blur(46px)',
            left: 0,
            top: 0,
            transform: 'translate3d(-9999px, -9999px, 0) rotate(-14deg)',
            transition: 'opacity 0.3s ease',
            willChange: 'transform, opacity',
          }}
        />
      )}

      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
