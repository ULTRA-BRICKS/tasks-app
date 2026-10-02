export type DraftClock = Record<string, number>;

/** Advance only the copy being edited; unrelated tabs are deliberately not merged. */
export function advanceClock(clock: DraftClock, writer: string): DraftClock {
  const next = (clock[writer] ?? 0) + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Draft version counter exhausted');
  return { ...clock, [writer]: next };
}

/** Wall-clock time is presentation metadata, never acknowledgement ordering. */
export function followsClock(a: DraftClock, b: DraftClock): boolean {
  let later = false;
  for (const [writer, count] of Object.entries(b)) {
    if ((a[writer] ?? 0) < count) return false;
    if ((a[writer] ?? 0) > count) later = true;
  }
  return later || Object.keys(a).some((writer) => !Object.hasOwn(b, writer));
}

export function sameClock(a: DraftClock, b: DraftClock): boolean {
  const writers = Object.keys(a);
  return (
    writers.length === Object.keys(b).length && writers.every((writer) => a[writer] === b[writer])
  );
}
