import type { ComponentProps } from 'react';
import { personProfile } from '@/shared/lib/people';
import { Avatar, PersonPopover } from '@/shared/ui';
// Same-slice cycle with the index is safe: the hooks are only called during render.
import { useCatalog, useMe } from './index';

/**
 * A person anywhere in the app: resolves any stored ID (member or imported profile) to the
 * canonical person and opens their card. Unknown IDs keep the plain avatar/name.
 */
export function PersonChip({
  id,
  name,
  ...card
}: {
  id: string | null | undefined;
  /** Name stored with the record, shown when the directory does not know the ID. */
  name?: string | null;
} & Omit<ComponentProps<typeof PersonPopover>, 'profile'>) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe();
  const profile = personProfile(catalog, id, me);
  if (profile) return <PersonPopover profile={profile} {...card} />;
  const text = card.label ?? name;
  if (card.display === 'text') return <span className="person-static">{text}</span>;
  return card.display === 'name' ? (
    <span className="person-static">
      <Avatar name={text} decorative />
      {text}
    </span>
  ) : (
    <Avatar name={text} />
  );
}
