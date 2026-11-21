const AUTH_BASE = 'https://accounts.shop.app';
const PUBLIC_CLIENT = '5c733ab2-1903-400a-891e-7ba20c09e2a3';
export class ShopOAuthError extends Error {
  constructor(public code: string, public status = 502) { super('Shop sign-in could not finish. Connect again when you are ready.'); }
}
export function createShopOAuth(fetcher: typeof fetch = fetch) {
  const clientId = () => process.env.SHOP_OAUTH_CLIENT_ID || PUBLIC_CLIENT;
  async function request(path: string, fields: Record<string, string>) {
    let response: Response;
    try {
      response = await fetcher(AUTH_BASE + path, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...fields, client_id: clientId(), ...(process.env.SHOP_OAUTH_CLIENT_SECRET ? { client_secret: process.env.SHOP_OAUTH_CLIENT_SECRET } : {}) }),
      });
    } catch { throw new ShopOAuthError('shop_signin_unavailable'); }
    let data;
    try { data = await response.json(); } catch { throw new ShopOAuthError('shop_signin_invalid_response'); }
    return { ok: response.ok, status: response.status, data };
  }
  return {
    async start() {
      const { ok, data } = await request('/oauth/device', { resource: 'https://mcp.shop.com', scope: 'openid email personal_agent', device_name: 'ClipThat gifting' });
      if (!ok || typeof data.device_code !== 'string' || typeof data.verification_uri !== 'string' || typeof data.user_code !== 'string') throw new ShopOAuthError('shop_signin_unavailable');
      const url = data.verification_uri_complete || data.verification_uri;
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'shop.app' || parsed.hostname.endsWith('.shop.app'))) throw new ShopOAuthError('shop_signin_invalid_response');
      return { deviceCode: data.device_code as string, url: url as string, code: data.user_code as string, interval: Math.max(5, Number(data.interval) || 5), expiresAt: Date.now() + Math.min(1800, Math.max(1, Number(data.expires_in) || 600)) * 1000 };
    },
    async poll(deviceCode: string) {
      const { ok, data } = await request('/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode });
      if (data.error === 'authorization_pending' || data.error === 'slow_down') return { status: data.error as 'authorization_pending' | 'slow_down' };
      if (!ok || typeof data.access_token !== 'string' || (typeof data.scope === 'string' && !data.scope.split(' ').includes('personal_agent'))) throw new ShopOAuthError('shop_signin_denied', 401);
      return { status: 'connected' as const, token: data.access_token as string, expiresAt: Date.now() + Math.min(86400, Math.max(1, Number(data.expires_in) || 3600)) * 1000 };
    },
  };
}
export type ShopOAuth = ReturnType<typeof createShopOAuth>;
