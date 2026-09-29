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
  display = 'avatar',
  label,
  className,
}: {
  id: string | null | undefined;
  /** Name stored with the record, shown when the directory does not know the ID. */
  name?: string | null;
  display?: 'avatar' | 'name';
  label?: string;
  className?: string;
}) {
  const { data: catalog } = useCatalog(),
    { data: me } = useMe();
  const profile = personProfile(catalog, id, me);
  if (profile)
    return (
      <PersonPopover profile={profile} display={display} label={label} className={className} />
    );
  const text = label ?? name;
  return display === 'name' ? (
    <span className="person-static">
      <Avatar name={text} decorative />
      {text}
    </span>
  ) : (
    <Avatar name={text} />
  );
}
