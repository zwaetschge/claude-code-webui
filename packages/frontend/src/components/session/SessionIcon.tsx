import { useState } from 'react';
import type { Session } from '@plum-code-webui/shared';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { toUiProvider } from '@/lib/providers';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

type SessionIconProps = {
  session: Pick<Session, 'cliProvider' | 'iconUrl' | 'name'>;
  className?: string;
  imageClassName?: string;
  logoClassName?: string;
  alt?: string;
};

export function SessionIcon({
  session,
  className,
  imageClassName,
  logoClassName,
  alt = '',
}: SessionIconProps) {
  const token = useAuthStore((state) => state.token);
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = session.iconUrl && failedIconUrl !== session.iconUrl ? session.iconUrl : null;
  const iconSrc = iconUrl && token ? appendToken(iconUrl, token) : iconUrl;

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={alt}
        className={cn('object-cover', className, imageClassName)}
        onError={() => setFailedIconUrl(iconUrl)}
      />
    );
  }

  return (
    <ProviderLogo
      provider={toUiProvider(session.cliProvider)}
      className={cn('object-contain', className, logoClassName)}
      alt={alt}
    />
  );
}

function appendToken(url: string, token: string): string {
  if (!url.startsWith('/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
