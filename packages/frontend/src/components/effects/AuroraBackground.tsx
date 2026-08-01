import { memo, useEffect, useRef } from 'react';
import { AURORA_WAVE_MOTIONS, startAmbientMotion } from '@/lib/ambientMotion';

interface AuroraBackgroundProps {
  intensity?: 'subtle' | 'default' | 'vivid';
}

export const AuroraBackground = memo(function AuroraBackground({
  intensity = 'default',
}: AuroraBackgroundProps) {
  const ribbonRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => startAmbientMotion(ribbonRefs.current, AURORA_WAVE_MOTIONS), []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 overflow-hidden aurora-backdrop aurora-${intensity}`}
      style={{ zIndex: 0 }}
    >
      <div className="aurora-galaxy" />
      <div
        ref={(element) => {
          ribbonRefs.current[0] = element;
        }}
        className="aurora-ribbon aurora-ribbon-1"
      />
      <div
        ref={(element) => {
          ribbonRefs.current[1] = element;
        }}
        className="aurora-ribbon aurora-ribbon-2"
      />
      <div
        ref={(element) => {
          ribbonRefs.current[2] = element;
        }}
        className="aurora-ribbon aurora-ribbon-3"
      />
      <div className="aurora-horizon" />
      <div className="aurora-grain" />
    </div>
  );
});
