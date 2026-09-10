'use client';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const TOKEN_KEY = 'ims_token';

/**
 * The session token lives in localStorage rather than a cookie the browser
 * sends automatically. This is an internal tool on a separate origin from the
 * API, and an explicitly attached Authorization header cannot be replayed by a
 * cross-site form post the way an ambient cookie can.
 */
export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Overrides JSON encoding — used by the CSV upload. */
  formData?: FormData;
  query?: Record<string, string | number | string[] | undefined>;
  /** Returns the raw response text instead of parsing JSON. */
  raw?: boolean;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }

  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    // The token expired or was revoked. Clearing it here means the very next
    // render lands on the login screen instead of a wall of failed requests.
    tokenStore.clear();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  if (!response.ok) {
    let code = 'error';
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      code = payload.code ?? code;
      // Nest's ValidationPipe returns `message` as an array of field errors.
      message = Array.isArray(payload.message)
        ? payload.message.join('; ')
        : (payload.message ?? message);
    } catch {
      /* Non-JSON error body — the status-derived message stands. */
    }
    throw new ApiError(response.status, code, message);
  }

  if (options.raw) return (await response.text()) as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** SWR fetcher: `useSWR('/accounts', fetcher)`. */
export const fetcher = <T,>(path: string) => api<T>(path);
