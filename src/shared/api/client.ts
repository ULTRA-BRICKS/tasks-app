export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: {
      current?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T>(
  path: string,
  options: RequestInit & {
    json?: unknown;
  } = {},
): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (!headers.has('x-tickets-csrf')) headers.set('x-tickets-csrf', '1');
  if (json !== undefined && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const endpoint = '/api' + path;
  const diagnosticPath = endpoint.split(/[?#]/, 1)[0];
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init,
      credentials: 'same-origin',
      headers,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_UNAVAILABLE',
      `Cannot reach ${diagnosticPath}. Check the API process and network; your unsaved changes are kept.`,
    );
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `${diagnosticPath} returned HTTP ${response.status} without valid JSON. ${response.headers.get('content-type')?.includes('text/html') ? 'An HTML page was returned instead of the API.' : 'Check the API process and proxy target.'}`,
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message ?? 'Request failed',
      data?.error?.details,
    );
  return data as T;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
