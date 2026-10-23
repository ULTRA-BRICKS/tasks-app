import { Readable } from 'node:stream';
import { resolveDevelopment } from '../config/development.mjs';
export function nodeHandler(app, baseUrl = resolveDevelopment(process.env).apiTarget) {
  return async function (req, res) {
    try {
      const method = req.method ?? 'GET';
      const request = new Request(new URL(req.url ?? '/', baseUrl), {
        method,
        headers: req.headers,
        ...(!['GET', 'HEAD'].includes(method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
      });
      const response = await app.fetch(request);
      const headers = Object.fromEntries(response.headers);
      // Object.fromEntries would keep only one of several Set-Cookie headers.
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers);
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":{"code":"INTERNAL_ERROR"}}');
      } else res.end();
    }
  };
}
