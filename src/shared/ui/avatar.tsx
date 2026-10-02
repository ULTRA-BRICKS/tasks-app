import { useState } from 'react';
import { cn } from '../lib/cn';
/** One of eight hues for initials, the same for a name on every surface (docs/PEOPLE-IDENTITY.md). */
function tone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % 8;
}
export function Avatar({
  name,
  src,
  size = 'sm',
  decorative = false,
}: {
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'md';
  /** Inside a control that is already named: no label and no native tooltip over a person card. */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = src && /^(?:https:\/\/|\/(?!\/))/.test(src) && src !== failed ? src : null;
  return (
    <span
      className={cn('avatar', size === 'md' && 'avatar-md', !name && 'avatar-empty')}
      data-tone={!image && name ? tone(name) : undefined}
      {...(decorative
        ? { 'aria-hidden': true }
        : { 'aria-label': name ?? 'Unassigned', title: name ?? 'Unassigned' })}
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
