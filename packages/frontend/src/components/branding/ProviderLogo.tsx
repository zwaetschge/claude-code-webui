import type { UiProvider } from '@/lib/providers';
import { cn } from '@/lib/utils';

type ProviderLogoProps = {
  provider: UiProvider;
  className?: string;
  alt?: string;
};

export function ProviderLogo({ provider, className, alt }: ProviderLogoProps) {
  if (provider === 'plum') {
    const resolvedAlt = alt === undefined ? 'Plum' : alt;
    return (
      <img
        src="/logos/plum.png"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'claude') {
    const resolvedAlt = alt === undefined ? 'Claude' : alt;
    return (
      <img
        src="/claude-logo.png"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'codex') {
    const resolvedAlt = alt === undefined ? 'Codex' : alt;
    return (
      <img
        src="/logos/codex.webp"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'zai') {
    const resolvedAlt = alt === undefined ? 'Z.AI' : alt;
    return (
      <img
        src="/logos/zai.png"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'gemini') {
    const resolvedAlt = alt === undefined ? 'Gemini' : alt;
    return (
      <img
        src="/logos/Gemini_CLI_logo.webp"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'multi') {
    const resolvedAlt = alt === undefined ? 'Multi-CLI' : alt;
    // Multi-CLI uses the Plum logo as it's part of the Plum branding
    return (
      <img
        src="/logos/plum.png"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden={!!alt ? undefined : true}
      role={alt ? 'img' : 'presentation'}
      className={className}
    >
      {alt ? <title>{alt}</title> : null}
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M20 34c4-10 20-10 24 0"
        fill="none"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="44" cy="22" r="3.5" fill="hsl(var(--brand-accent))" />
    </svg>
  );
}
