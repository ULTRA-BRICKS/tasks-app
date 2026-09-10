import { cn } from '../lib/cn';
export function Avatar({ name, size = 'sm' }: { name?: string | null; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('avatar', size === 'md' && 'avatar-md', !name && 'avatar-empty')}
      aria-label={name ?? 'Unassigned'}
      title={name ?? 'Unassigned'}
    >
      {name
        ? name
            .split(/\s+/)
            .map((s) => s[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()
        : '–'}
    </span>
  );
}
