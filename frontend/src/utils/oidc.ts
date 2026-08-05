import { safeInternalRedirect } from './internalRedirect';

const OIDC_START_PATH = '/api/auth/oidc/start';

export function oidcStartUrl(redirect: unknown): string {
  const query = new URLSearchParams({ redirect: safeInternalRedirect(redirect) });
  return `${OIDC_START_PATH}?${query.toString()}`;
}

export function beginOidcAuthorization(redirect: unknown): void {
  window.location.assign(oidcStartUrl(redirect));
}
