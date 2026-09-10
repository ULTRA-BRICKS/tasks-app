export class TicketsApiError extends Error {
  constructor(response, data) {
    super(data?.error?.message ?? `HTTP ${response.status}`);
    this.name = 'TicketsApiError';
    this.status = response.status;
    this.code = data?.error?.code ?? 'HTTP_ERROR';
    this.details = data?.error?.details;
    this.requestId = data?.error?.request_id;
  }
}
export class TicketsClient {
  constructor({ url, token, fetcher = fetch, timeout = 15000 }) {
    this.url = new URL(url);
    if (
      this.url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(this.url.hostname)
    )
      throw new Error('Use HTTPS outside localhost');
    this.token = token;
    this.fetcher = fetcher;
    this.timeout = timeout;
  }
  async request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    if (!path.startsWith('/api/')) throw new Error('SDK paths must start with /api/');
    const response = await this.fetcher(new URL(path, this.url), {
      method,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : { 'x-tickets-csrf': '1' }),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.timeout),
      credentials: 'include',
    });
    const content = await response.text();
    let data;
    try {
      data = content ? JSON.parse(content) : null;
    } catch {
      throw new Error(`Server returned non-JSON (HTTP ${response.status})`);
    }
    if (!response.ok) throw new TicketsApiError(response, data);
    return data;
  }
  async listIssues(filters = {}, pagination = {}) {
    const query = new URLSearchParams(
      Object.entries({ ...filters, ...pagination })
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    );
    return this.request('/api/v1/issues?' + query);
  }
  async *issues(filters = {}) {
    let cursor;
    do {
      const page = await this.listIssues(filters, { limit: 200, cursor });
      yield* page.data;
      cursor = page.next_cursor;
    } while (cursor);
  }
  issue(key) {
    return this.request('/api/v1/issues/' + encodeURIComponent(key));
  }
  createIssue(input, { idempotencyKey } = {}) {
    return this.request('/api/v1/issues', {
      method: 'POST',
      body: input,
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
    });
  }
  updateIssue(key, input) {
    return this.request('/api/v1/issues/' + encodeURIComponent(key), {
      method: 'PATCH',
      body: input,
    });
  }
  comment(key, body) {
    return this.request('/api/v1/issues/' + encodeURIComponent(key) + '/comments', {
      method: 'POST',
      body: { body },
    });
  }
  catalog() {
    return this.request('/api/v1/catalog');
  }
}
