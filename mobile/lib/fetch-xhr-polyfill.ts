// Workaround for https://github.com/expo/expo/issues/40061
//
// Why: Expo SDK 54 + RN 0.81 + Hermes has a regression in the native fetch
// stack on Android. fetch() and anything riding it (axios fetch-adapter,
// expo-auth-session, etc.) silently fails with "Network Error" on physical
// devices — particularly on IPv6-first cellular (Jio 5G in India). The
// emulator works because it uses the host machine's IPv4 Wi-Fi.
//
// XMLHttpRequest in React Native uses a different native path that doesn't
// trip the regression, so we replace global.fetch with an XHR-backed
// implementation. Android-only — iOS is unaffected.

import { Platform } from 'react-native';

if (Platform.OS === 'android' && !(global as any).__fetchXhrPolyfilled) {
  (global as any).__fetchXhrPolyfilled = true;

  const originalFetch = global.fetch;

  const xhrFetch: typeof fetch = (input, init = {}) => {
    return new Promise<Response>((resolve, reject) => {
      const url =
        typeof input === 'string'
          ? input
          : (input as URL).toString
          ? (input as URL).toString()
          : (input as Request).url;
      const method = (init.method || 'GET').toUpperCase();

      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);

      // Cookies / credentials
      if (init.credentials === 'include' || init.credentials === 'same-origin') {
        xhr.withCredentials = true;
      }

      // Headers
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => xhr.setRequestHeader(key, value));
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            xhr.setRequestHeader(key, value);
          }
        } else {
          for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
            xhr.setRequestHeader(key, value);
          }
        }
      }

      // AbortSignal
      if (init.signal) {
        if (init.signal.aborted) {
          xhr.abort();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        init.signal.addEventListener('abort', () => xhr.abort());
      }

      xhr.onload = () => {
        const responseHeaders = new Headers();
        const headerString = xhr.getAllResponseHeaders();
        if (headerString) {
          headerString
            .trim()
            .split(/[\r\n]+/)
            .forEach((line) => {
              const idx = line.indexOf(': ');
              if (idx > 0) {
                responseHeaders.append(line.slice(0, idx), line.slice(idx + 2));
              }
            });
        }
        const body = xhr.responseType === 'arraybuffer' ? xhr.response : xhr.responseText;
        resolve(
          new Response(body, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: responseHeaders,
          }),
        );
      };

      xhr.onerror = () => reject(new TypeError(`Network request failed: ${url}`));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
      xhr.ontimeout = () => reject(new TypeError(`Network request timed out: ${url}`));

      xhr.send((init.body as any) ?? null);
    });
  };

  // Preserve original as fallback for callers that opt out
  (global as any).__nativeFetch = originalFetch;
  global.fetch = xhrFetch as typeof fetch;
}
