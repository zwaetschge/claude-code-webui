import { useId } from 'react';
import type { UiProvider } from '@/lib/providers';

interface LoaderProps {
  size?: number;
  className?: string;
  accent?: boolean;
}

function GooFilter({ id, stdDeviation = 6 }: { id: string; stdDeviation?: number }) {
  return (
    <filter id={id}>
      <feGaussianBlur stdDeviation={stdDeviation} />
      <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11" />
    </filter>
  );
}

// Template A #01 — Metaball morph: three lobes orbiting a central core,
// goo-merged into one living blob.
function ClaudeLoader({ size = 44, className, accent }: LoaderProps) {
  const id = useId().replace(/:/g, '');
  const fill = accent ? 'rgb(59 130 246)' : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      style={{ filter: `url(#${id}-goo)` }}
      aria-hidden="true"
    >
      <defs>
        <GooFilter id={`${id}-goo`} stdDeviation={6} />
      </defs>
      <g fill={fill}>
        <circle cx="100" cy="100" r="28" />
        <g className="pl-claude-orbit" style={{ transformOrigin: '100px 100px' }}>
          <circle className="pl-claude-a" cx="100" cy="50" r="22" />
          <circle className="pl-claude-b" cx="143" cy="125" r="22" />
          <circle className="pl-claude-c" cx="57" cy="125" r="22" />
        </g>
      </g>
    </svg>
  );
}

// Template A #15 — Radial blobs (rotating halo)
function CodexLoader({ size = 44, className, accent }: LoaderProps) {
  const id = useId().replace(/:/g, '');
  const fill = accent ? 'rgb(59 130 246)' : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      className={`pl-codex-spin ${className ?? ''}`}
      style={{ filter: `url(#${id}-goo)` }}
      aria-hidden="true"
    >
      <defs>
        <GooFilter id={`${id}-goo`} stdDeviation={4} />
      </defs>
      <g fill={fill}>
        <circle className="pl-codex-k1" cx="80" cy="20" r="10" />
        <circle className="pl-codex-k2" cx="132" cy="50" r="10" />
        <circle className="pl-codex-k3" cx="132" cy="110" r="10" />
        <circle className="pl-codex-k4" cx="80" cy="140" r="10" />
        <circle className="pl-codex-k5" cx="28" cy="110" r="10" />
        <circle className="pl-codex-k6" cx="28" cy="50" r="10" />
      </g>
    </svg>
  );
}

// Template A #07 — Lava lamp
function OpenCodeLoader({ size = 44, className, accent }: LoaderProps) {
  const id = useId().replace(/:/g, '');
  const fill = accent ? 'rgb(59 130 246)' : 'currentColor';
  // Container is a vertical pill; size controls height, width ~= size * 0.625
  const w = Math.round(size * 0.625);
  const h = size;
  return (
    <div
      className={`pl-opencode-lamp ${className ?? ''}`}
      style={{ width: w, height: h }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 160" preserveAspectRatio="none" style={{ filter: `url(#${id}-goo)` }}>
        <defs>
          <GooFilter id={`${id}-goo`} stdDeviation={6} />
        </defs>
        <g fill={fill}>
          <circle className="pl-opencode-b1" cx="30" cy="80" r="14" />
          <circle className="pl-opencode-b2" cx="55" cy="90" r="10" />
          <circle className="pl-opencode-b3" cx="70" cy="85" r="12" />
        </g>
      </svg>
    </div>
  );
}

export function ProviderLoader({
  provider,
  size,
  className,
  accent,
}: {
  provider: UiProvider;
  size?: number;
  className?: string;
  accent?: boolean;
}) {
  switch (provider) {
    case 'codex':
      return <CodexLoader size={size} className={className} accent={accent} />;
    case 'opencode':
      return <OpenCodeLoader size={size} className={className} accent={accent} />;
    case 'claude':
    case 'plum':
    default:
      return <ClaudeLoader size={size} className={className} accent={accent} />;
  }
}
