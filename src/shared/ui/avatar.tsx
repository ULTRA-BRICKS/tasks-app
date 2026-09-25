import { useState } from 'react';
import { cn } from '../lib/cn';
export function Avatar({
  name,
  src,
  size = 'sm',
}: {
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = src && /^(?:https:\/\/|\/(?!\/))/.test(src) && src !== failed ? src : null;
  return (
    <span
      className={cn('avatar', size === 'md' && 'avatar-md', !name && 'avatar-empty')}
      aria-label={name ?? 'Unassigned'}
      title={name ?? 'Unassigned'}
    >
      {image ? (
        <img
          src={image}
          alt=""
          width={size === 'md' ? 32 : 22}
          height={size === 'md' ? 32 : 22}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(image)}
        />
      ) : name ? (
        name
          .split(/\s+/)
          .map((word) => word[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      ) : (
        '–'
      )}
    </span>
  );
}
