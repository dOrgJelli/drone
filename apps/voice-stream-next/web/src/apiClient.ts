import type { ApiClient, DevUser } from './dashboardTypes.js';

const devUserStorageKey = 'voiceStreamNext.devUser';

export function defaultDevUser(): DevUser {
  return { email: 'developer@example.local', name: 'Local Developer', admin: false };
}

export function readDevUser(): DevUser {
  try {
    const parsed = JSON.parse(localStorage.getItem(devUserStorageKey) || 'null');
    return {
      email: String(parsed?.email ?? defaultDevUser().email),
      name: String(parsed?.name ?? defaultDevUser().name),
      admin: Boolean(parsed?.admin ?? false),
    };
  } catch {
    return defaultDevUser();
  }
}

export function createDevClient(user: DevUser): ApiClient {
  return {
    async request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      headers.set('content-type', headers.get('content-type') || 'application/json');
      headers.set('x-voice-dev-user-email', user.email);
      headers.set('x-voice-dev-user-name', user.name);
      headers.set('x-voice-dev-admin', '0');
      return requestJson<T>(path, { ...init, headers });
    },
  };
}

export function createClerkClient(getToken: () => Promise<string | null>): ApiClient {
  return {
    async request<T>(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers);
      headers.set('content-type', headers.get('content-type') || 'application/json');
      const token = await getToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
      return requestJson<T>(path, { ...init, headers });
    },
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${path}`);
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}
