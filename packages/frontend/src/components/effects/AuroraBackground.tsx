import { memo } from 'react';

interface AuroraBackgroundProps {
  intensity?: 'subtle' | 'default' | 'vivid';
}

export const AuroraBackground = memo(function AuroraBackground({
  intensity = 'default',
}: AuroraBackgroundProps) {
  const opacityMap = {
    subtle: 0.18,
    default: 0.28,
    vivid: 0.4,
  } as const;
  const orbOpacity = opacityMap[intensity];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      <div className="aurora-orb aurora-orb-1" style={{ opacity: orbOpacity }} />
      <div className="aurora-orb aurora-orb-2" style={{ opacity: orbOpacity }} />
      <div className="aurora-orb aurora-orb-3" style={{ opacity: orbOpacity * 0.8 }} />
      <div className="aurora-grain" />
    </div>
  );
});
