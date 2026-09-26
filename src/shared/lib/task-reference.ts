/** Receives one already-decoded router segment; never decode again or accept a path as an ID. */
export function taskReference(segment: string): string | null {
  if (segment.length > 2048 || /[/?#]/.test(segment)) return null;
  for (let i = 0; i < segment.length; i++) {
    const charCode = segment.charCodeAt(i);
    if (charCode < 32 || charCode === 127) return null;
  }
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(segment))
    return segment.toLowerCase();
  const match = /^([a-z][a-z0-9]{1,9}-[1-9][0-9]{0,14})(?:-[^/?#]+)?$/i.exec(segment);
  return match ? match[1].toUpperCase() : null;
}
