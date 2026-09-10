// Date-only fields are never parsed in the user's timezone.
export function formatDate(date: string | null | undefined, full = false) {
  if (!date) return 'No date';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(full ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(date.length === 10 ? date + 'T12:00:00Z' : date));
}
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function isOverdue(date: string | null | undefined, category?: string) {
  return Boolean(date && date < localDate() && !['completed', 'canceled'].includes(category ?? ''));
}
