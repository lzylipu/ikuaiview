const MAX_INTERNAL_REDIRECT_BYTES = 2_048;
const OIDC_COMPLETION_PATH = '/login/oidc/complete';
const UTF8_ENCODER = new TextEncoder();

function isOidcCompletionPath(value: string): boolean {
  const pathname = new URL(value, 'https://ikuaiview.invalid').pathname;
  return pathname.replace(/\/+$/, '').toLowerCase() === OIDC_COMPLETION_PATH;
}

export function safeInternalRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (value.length === 0 || value.length > MAX_INTERNAL_REDIRECT_BYTES) return '/';
  if (UTF8_ENCODER.encode(value).byteLength > MAX_INTERNAL_REDIRECT_BYTES) {
    return '/';
  }
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || /\p{Cc}/u.test(value)) return '/';
  if (isOidcCompletionPath(value)) return '/';
  return value;
}
