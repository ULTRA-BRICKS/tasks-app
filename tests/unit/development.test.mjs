import { test, expect } from 'bun:test';
import {
  DEFAULT_API_PORT,
  DEFAULT_WEB_PORT,
  resolveDevelopment,
  isAllowedOrigin,
  applicationOrigin,
} from '../../packages/config/development.mjs';

test('one source of defaults resolves API port 8888 and separate web port', () => {
  const c = resolveDevelopment();
  expect(c.apiPort).toBe(DEFAULT_API_PORT);
  expect(c.apiPort).toBe(8888);
  expect(c.webPort).toBe(DEFAULT_WEB_PORT);
  expect(c.apiTarget).toBe('http://127.0.0.1:8888');
});
test('custom ports determine proxy and public origin consistently', () => {
  expect(resolveDevelopment({ API_PORT: '9011', WEB_PORT: '9012' })).toMatchObject({
    apiPort: 9011,
    webPort: 9012,
    apiTarget: 'http://127.0.0.1:9011',
    appUrl: 'http://localhost:9012',
  });
});
for (const value of ['-1', '0', '65536', '0x22', 'Infinity', '8888x', '4.2', ' 8888 '])
  test(`invalid port ${value} is rejected`, () =>
    expect(() => resolveDevelopment({ API_PORT: value })).toThrow('API_PORT'));
test('equal listener ports fail instead of proxying back into Vite', () =>
  expect(() => resolveDevelopment({ API_PORT: '5173' })).toThrow('different'));
test('wildcard API bind addresses use loopback as proxy target', () => {
  expect(resolveDevelopment({ API_HOST: '0.0.0.0' }).apiTarget).toBe('http://127.0.0.1:8888');
  expect(resolveDevelopment({ API_HOST: '::' }).apiTarget).toBe('http://[::1]:8888');
});
test('development accepts equivalent loopback origins only at the exact web port', () => {
  expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  expect(isAllowedOrigin('http://[::1]:5173')).toBe(true);
  for (const origin of [
    'http://127.0.0.1:8888',
    'http://localhost:5174',
    'https://localhost:5173',
    'http://localhost.attacker.test:5173',
    'null',
    '*',
    'http://user@localhost:5173',
  ])
    expect(isAllowedOrigin(origin)).toBe(false);
});
test('production accepts only explicit HTTPS origin, never aliases', () => {
  const env = { NODE_ENV: 'production', APP_URL: 'https://localhost:5173' };
  expect(isAllowedOrigin('https://localhost:5173', env)).toBe(true);
  expect(isAllowedOrigin('https://127.0.0.1:5173', env)).toBe(false);
  expect(() => applicationOrigin({ NODE_ENV: 'production' })).toThrow('APP_URL');
  expect(() => applicationOrigin({ NODE_ENV: 'production', APP_URL: 'http://localhost' })).toThrow(
    'HTTPS',
  );
});
