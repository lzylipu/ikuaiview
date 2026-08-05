import type { AuthMethod } from '@/api';

export function authMethodLabel(method: AuthMethod, providerName: string | null): string {
  if (method === 'oidc') return `${providerName || 'OIDC'} 单点登录`;
  if (method === 'pairing') return '设备配对';
  return '本地密码';
}
