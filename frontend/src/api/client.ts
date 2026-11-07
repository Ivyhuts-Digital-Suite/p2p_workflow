import axios from 'axios';

export const TOKEN_KEY = 'p2p_token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

/** The structured details of an API error, for the rare screen that responds to them. */
export function errorDetails<T>(err: unknown): T | undefined {
  return axios.isAxiosError(err) ? ((err.response?.data as { details?: T } | undefined)?.details) : undefined;
}

/** Extracts a readable message (plus business-rule details) from an API error. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; details?: unknown } | undefined;
    if (!data?.message) return err.message;
    if (Array.isArray(data.details)) {
      const lines = data.details.map((d: { message?: string }) => d.message ?? JSON.stringify(d));
      return `${data.message}: ${lines.join('; ')}`;
    }
    // zod validation errors: { formErrors: string[], fieldErrors: { field: string[] } }
    const fieldErrors = (data.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    if (fieldErrors && Object.keys(fieldErrors).length) {
      const lines = Object.entries(fieldErrors).map(([field, msgs]) => `${field}: ${msgs.join(', ')}`);
      return `${data.message} - ${lines.join('; ')}`;
    }
    return data.message;
  }
  return err instanceof Error ? err.message : String(err);
}
