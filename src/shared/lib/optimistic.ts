/** Roll back our unchanged optimistic copies, including overlapping infinite pages. */
export function rollbackOptimistic<
  T extends { id: string; version: number },
  P extends { data: T[] },
  L extends { pages: P[] },
>(current: L, previous: L | undefined, id: string, version: number, patch: object): L {
  let original: T | undefined;
  for (const page of previous?.pages ?? []) {
    original = page.data.find((row) => row.id === id && row.version === version);
    if (original) break;
  }
  if (!original) return current;
  const expected = Object.entries(patch).map(([key, value]) => [key, JSON.stringify(value)]);
  let pages = current.pages;
  for (let i = 0; i < current.pages.length; i++) {
    const page = current.pages[i];
    let data = page.data;
    for (let j = 0; j < page.data.length; j++) {
      const row = page.data[j];
      if (
        row.id !== id ||
        row.version !== version ||
        !expected.every(
          ([key, value]) =>
            JSON.stringify((row as unknown as Record<string, unknown>)[key]) === value,
        )
      )
        continue;
      if (data === page.data) data = [...page.data];
      data[j] = original;
    }
    if (data !== page.data) {
      if (pages === current.pages) pages = [...current.pages];
      pages[i] = { ...page, data };
    }
  }
  return pages === current.pages ? current : { ...current, pages };
}
