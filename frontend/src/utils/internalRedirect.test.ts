import { describe, expect, it } from 'vitest';
import { safeInternalRedirect } from './internalRedirect';
import { oidcStartUrl } from './oidc';

describe('safeInternalRedirect', () => {
  it('accepts only bounded single-slash site paths', () => {
    expect(safeInternalRedirect('/traffic?wan=ether1#latest')).toBe('/traffic?wan=ether1#latest');
    expect(safeInternalRedirect('https://example.test/traffic')).toBe('/');
    expect(safeInternalRedirect('//example.test/traffic')).toBe('/');
    expect(safeInternalRedirect('/\\example.test/traffic')).toBe('/');
    expect(safeInternalRedirect('/traffic\nnext')).toBe('/');
    expect(safeInternalRedirect('/traffic\u0085next')).toBe('/');
    expect(safeInternalRedirect(['/traffic', '/settings'])).toBe('/');
    expect(safeInternalRedirect(`/${'a'.repeat(2_048)}`)).toBe('/');
  });

  it('uses the backend UTF-8 byte boundary and excludes the completion route', () => {
    const exactByteLimit = `/${'界'.repeat(682)}a`;
    expect(new TextEncoder().encode(exactByteLimit)).toHaveLength(2_048);
    expect(safeInternalRedirect(exactByteLimit)).toBe(exactByteLimit);
    expect(safeInternalRedirect(`/${'界'.repeat(683)}`)).toBe('/');
    expect(safeInternalRedirect('/login/oidc/complete?redirect=/traffic')).toBe('/');
    expect(safeInternalRedirect('/LOGIN/OIDC/COMPLETE/')).toBe('/');
  });

  it('encodes the validated redirect in the OIDC start URL', () => {
    expect(oidcStartUrl('/traffic?wan=ether1 backup')).toBe(
      '/api/auth/oidc/start?redirect=%2Ftraffic%3Fwan%3Dether1+backup',
    );
    expect(oidcStartUrl('//outside.example')).toBe('/api/auth/oidc/start?redirect=%2F');
    expect(oidcStartUrl('/login/oidc/complete')).toBe('/api/auth/oidc/start?redirect=%2F');
  });
});
