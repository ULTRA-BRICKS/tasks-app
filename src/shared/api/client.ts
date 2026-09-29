export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: {
      current?: unknown;
    },
    /** Server-requested delay for 429 replies, capped at one hour. */
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
/** Session policy supplied by the app shell (the persistent read cache owns it). */
export interface ApiSession {
  /** False while the UI shows a saved copy whose session is not yet confirmed. */
  canWrite: () => boolean;
  /** A non-auth route answered 401: the session expired or was revoked. */
  onUnauthorized: (path: string) => void;
}
let session: ApiSession | null = null;
export function setApiSession(next: ApiSession | null) {
  session = next;
}
const RETRY_AFTER_CAP_MS = 3_600_000;
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(Math.max(delay, 0), RETRY_AFTER_CAP_MS) : undefined;
}
export async function api<T>(
  path: string,
  options: RequestInit & {
    json?: unknown;
  } = {},
): Promise<T> {
  const { json, ...init } = options;
  const authRoute = path.startsWith('/auth/');
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !authRoute && session && !session.canWrite())
    throw new ApiError(
      0,
      'READ_ONLY_SAVED_COPY',
      'Tasks is showing a saved copy until your session is confirmed. Nothing was sent; your unsaved text is kept.',
    );
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
  // Report revocation before parsing, so a non-JSON 401 still clears the private cache.
  if (response.status === 401 && !authRoute) session?.onUnauthorized(path.split(/[?#]/, 1)[0]);
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
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message ?? 'Request failed',
      data?.error?.details,
      response.status === 429 ? retryAfter(response.headers.get('retry-after')) : undefined,
    );
  }
  return data as T;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
