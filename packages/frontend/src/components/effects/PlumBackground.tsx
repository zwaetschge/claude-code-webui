import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface PlumBackgroundProps {
  className?: string;
  enableCursorGlow?: boolean;
}

export function PlumBackground({ className, enableCursorGlow = true }: PlumBackgroundProps) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMouseInside, setIsMouseInside] = useState(true);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enableCursorGlow) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Use requestAnimationFrame for smooth performance
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setMousePos({ x: e.clientX, y: e.clientY });
      });
    };

    const handleMouseEnter = () => setIsMouseInside(true);
    const handleMouseLeave = () => setIsMouseInside(false);

    // Listen on window for global mouse tracking
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseenter', handleMouseEnter);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseenter', handleMouseEnter);
      window.removeEventListener('mouseleave', handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enableCursorGlow]);

  return (
    <div
      className={cn("fixed inset-0 overflow-hidden pointer-events-none", className)}
    >
      {/* Frosted glass base layer */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-[100px]" />

      {/* Animated floating orbs */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full blur-[120px] animate-plum-float-1"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, transparent 70%)',
          top: '10%',
          left: '5%',
        }}
      />
      <div
        className="absolute w-[400px] h-[400px] rounded-full blur-[100px] animate-plum-float-2"
        style={{
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.2) 0%, transparent 70%)',
          top: '50%',
          right: '10%',
        }}
      />
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[140px] animate-plum-float-3"
        style={{
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.15) 0%, transparent 70%)',
          bottom: '5%',
          left: '30%',
        }}
      />
      <div
        className="absolute w-[350px] h-[350px] rounded-full blur-[80px] animate-plum-float-4"
        style={{
          background: 'radial-gradient(circle, rgba(147, 51, 234, 0.2) 0%, transparent 70%)',
          top: '30%',
          left: '60%',
        }}
      />

      {/* Cursor-following violet glow - slightly brighter than ambient orbs */}
      {enableCursorGlow && (
        <div
          className={cn(
            "fixed rounded-full pointer-events-none z-50",
            isMouseInside ? "opacity-100" : "opacity-0"
          )}
          style={{
            width: '450px',
            height: '450px',
            background: 'radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(139, 92, 246, 0.2) 40%, transparent 70%)',
            filter: 'blur(80px)',
            left: mousePos.x - 225,
            top: mousePos.y - 225,
            transition: 'opacity 0.3s ease',
            willChange: 'left, top',
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

      {/* CSS animations */}
      <style>{`
        @keyframes plum-float-1 {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          25% {
            transform: translate(30px, -20px) scale(1.1);
          }
          50% {
            transform: translate(-20px, 30px) scale(0.95);
          }
          75% {
            transform: translate(20px, 10px) scale(1.05);
          }
        }

        @keyframes plum-float-2 {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-40px, 20px) scale(1.15);
          }
          66% {
            transform: translate(30px, -30px) scale(0.9);
          }
        }

        @keyframes plum-float-3 {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          20% {
            transform: translate(20px, -40px) scale(1.1);
          }
          40% {
            transform: translate(-30px, -20px) scale(0.95);
          }
          60% {
            transform: translate(40px, 20px) scale(1.05);
          }
          80% {
            transform: translate(-10px, 30px) scale(1);
          }
        }

        @keyframes plum-float-4 {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-50px, 40px) scale(1.2);
          }
        }

        .animate-plum-float-1 {
          animation: plum-float-1 20s ease-in-out infinite;
        }

        .animate-plum-float-2 {
          animation: plum-float-2 25s ease-in-out infinite;
        }

        .animate-plum-float-3 {
          animation: plum-float-3 30s ease-in-out infinite;
        }

        .animate-plum-float-4 {
          animation: plum-float-4 15s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
