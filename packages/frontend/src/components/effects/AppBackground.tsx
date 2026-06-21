import { memo } from 'react';
import type { BackgroundAnimation } from '@plum-code-webui/shared';
import { AuroraBackground } from '@/components/effects/AuroraBackground';
import { cn } from '@/lib/utils';

interface AppBackgroundProps {
  animation: BackgroundAnimation;
}

export const AppBackground = memo(function AppBackground({ animation }: AppBackgroundProps) {
  if (animation === 'aurora') {
    return <AuroraBackground intensity="vivid" />;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed inset-0 overflow-hidden plum-app-background',
        `plum-bg-${animation}`
      )}
      style={{ zIndex: 0 }}
    >
      <div className="plum-bg-base" />
      <div className="plum-bg-sheet plum-bg-sheet-a" />
      <div className="plum-bg-sheet plum-bg-sheet-b" />
      <div className="plum-bg-line plum-bg-line-a" />
      <div className="plum-bg-line plum-bg-line-b" />
      <div className="plum-bg-special plum-bg-special-a" />
      <div className="plum-bg-special plum-bg-special-b" />
      <div className="plum-bg-special plum-bg-special-c" />
      <div className="plum-bg-grain" />
    </div>
  );
});
