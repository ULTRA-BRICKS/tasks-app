import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DraftPersistenceProvider,
  useDraftPersistence,
  type DraftPersistenceView,
} from '../../src/shared/lib/draft-persistence-context';
import type { DraftStorage } from '../../src/shared/lib/draft-persistence';

const storage = (): DraftStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
};

test('state-lib has no module-level fallback: a missing provider is an error', () => {
  function Reader() {
    useDraftPersistence();
    return null;
  }
  expect(() => renderToStaticMarkup(<Reader />)).toThrow('DraftPersistenceProvider is missing');
});

test('each provider mount owns a distinct store over its own ports', () => {
  const seen: DraftPersistenceView[] = [];
  function Reader({ text }: { text: string }) {
    const store = useDraftPersistence();
    store.setItem('input-draft:w:u:x', text);
    seen.push(store);
    return <>{store.getItem('input-draft:w:u:x')}</>;
  }
  const render = (text: string) =>
    renderToStaticMarkup(
      <DraftPersistenceProvider ports={{ local: storage(), session: storage() }}>
        <Reader text={text} />
      </DraftPersistenceProvider>,
    );
  expect(render('one')).toBe('one');
  expect(render('two')).toBe('two');
  expect(seen[0]).not.toBe(seen[1]);
});
