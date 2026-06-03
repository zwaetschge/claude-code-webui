import { memo } from 'react';

interface AuroraBackgroundProps {
  intensity?: 'subtle' | 'default' | 'vivid';
}

export const AuroraBackground = memo(function AuroraBackground({
  intensity = 'default',
}: AuroraBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 overflow-hidden aurora-backdrop aurora-${intensity}`}
      style={{ zIndex: 0 }}
    >
      <div className="aurora-stars" />
      <div className="aurora-galaxy" />
      <div className="aurora-ribbon aurora-ribbon-1" />
      <div className="aurora-ribbon aurora-ribbon-2" />
      <div className="aurora-ribbon aurora-ribbon-3" />
      <div className="aurora-horizon" />
      <div className="aurora-grain" />
    </div>
  );
});
