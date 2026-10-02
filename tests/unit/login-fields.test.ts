import { test, expect } from 'bun:test';
import { readLoginFields, formText, isComposingEnter } from '../../src/shared/lib/login-fields';

test('email is trimmed while passwords keep significant surrounding whitespace', () => {
  const data = new FormData();
  data.set('email', ' user@example.test ');
  data.set('password', ' secret with spaces ');
  expect(readLoginFields(data)).toEqual({
    email: 'user@example.test',
    password: ' secret with spaces ',
  });
});
test('missing fields and file values are never coerced into credentials', () => {
  const data = new FormData();
  expect(readLoginFields(data)).toEqual({ email: '', password: '' });
  data.set('email', new File(['synthetic'], 'test.txt'));
  expect(formText(data, 'email')).toBe('');
});
test('each submission reads fresh browser fields without retaining an older snapshot', () => {
  const data = new FormData();
  data.set('email', 'first@example.test');
  data.set('password', 'one');
  const first = readLoginFields(data);
  data.set('email', 'second@example.test');
  data.set('password', 'two');
  expect(readLoginFields(data)).toEqual({ email: 'second@example.test', password: 'two' });
  expect(first).toEqual({ email: 'first@example.test', password: 'one' });
});
test('composition confirmation is distinct from submit Enter, including Safari legacy keyCode', () => {
  expect(isComposingEnter({ key: 'Enter', isComposing: true })).toBe(true);
  expect(isComposingEnter({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(true);
  expect(isComposingEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(false);
  expect(isComposingEnter({ key: 'a', isComposing: true })).toBe(false);
});
