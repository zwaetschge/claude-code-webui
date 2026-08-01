import { useState } from 'react';
import type { Session } from '@plum-code-webui/shared';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { toUiProvider } from '@/lib/providers';
import {
  buildSessionIconSrc,
  DEFAULT_SESSION_ICON_THUMBNAIL_SIZE,
  type SessionIconThumbnailSize,
} from '@/lib/sessionIconUrl';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

type SessionIconProps = {
  session: Pick<Session, 'cliProvider' | 'iconUrl' | 'name'>;
  className?: string;
  imageClassName?: string;
  logoClassName?: string;
  alt?: string;
  thumbnailSize?: SessionIconThumbnailSize | null;
};

export function SessionIcon({
  session,
  className,
  imageClassName,
  logoClassName,
  alt = '',
  thumbnailSize = DEFAULT_SESSION_ICON_THUMBNAIL_SIZE,
}: SessionIconProps) {
  const token = useAuthStore((state) => state.token);
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = session.iconUrl && failedIconUrl !== session.iconUrl ? session.iconUrl : null;
  const iconSrc = iconUrl ? buildSessionIconSrc(iconUrl, token, thumbnailSize) : null;

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={alt}
        className={cn('object-cover', className, imageClassName)}
        loading="lazy"
        decoding="async"
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
