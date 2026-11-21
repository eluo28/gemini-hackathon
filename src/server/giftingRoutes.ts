import crypto from 'node:crypto';
import express from 'express';
import { createGiftingService, GiftError, type ViewerSession, type GiftingService } from './gifting';
import { ShopMcpError } from './shopMcp';
import { ShopOAuthError } from './shopOAuth';
import { requireProfileOrigin } from './profileOrigin';

const text = (value: unknown, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new GiftError('Invalid gift request.');
  return value;
};
function selection(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new GiftError('Invalid product options.');
  return value.map(option => ({ name: text(option?.name, 100), label: text(option?.label, 100) }));
}
export function createGiftingRouter(service: GiftingService = createGiftingService()) {
  const router = express.Router();
  const sessions = new Map<string, ViewerSession>();
  const limits = new Map<string, { started: number; count: number }>();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now && !session.busy) sessions.delete(id);
    for (const [ip, limit] of limits) if (now - limit.started >= 60_000) limits.delete(ip);
    const ip = req.ip || 'unknown';
    const limit = limits.get(ip) || { started: now, count: 0 };
    if (limit.count >= 90 || (!limits.has(ip) && limits.size >= 1000)) { res.status(429).json({ error: 'Too many gifting requests. Wait a minute.' }); return; }
    limit.count++; limits.set(ip, limit);
    next();
  });
  const route = (method: 'get' | 'post', path: string, handler: (session: ViewerSession, body: any) => unknown) => {
    router[method](path, ...(method === 'post' ? [requireProfileOrigin()] : []), async (req, res) => {
      let session: ViewerSession | undefined;
      try {
        const raw = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('shop_viewer='))?.slice('shop_viewer='.length);
        session = raw && /^[a-f0-9]{64}$/.test(raw) ? sessions.get(raw) : undefined;
        if (!session) {
          // Only explicit session startup may create a session. A restart never
          // reconstructs or resubmits an old checkout from caller-provided IDs.
          if (path !== '/session') throw new GiftError('Your Shop session expired. Reopen the gift panel. If payment was submitted, check its order before trying another purchase.', 401);
          if (sessions.size >= 1000) throw new GiftError('Gifting is busy. Try later.', 503);
          const id = crypto.randomBytes(32).toString('hex');
          session = { id, busy: false, expiresAt: Date.now() + 24 * 3600_000 };
          sessions.set(id, session);
          res.cookie('shop_viewer', id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/gifting', maxAge: 24 * 3600_000 });
        }
        if (session.busy) throw new GiftError('Your previous request is still processing.', 409);
        session.busy = true;
        try { res.json(await handler(session, req.body || {})); }
        finally { session.busy = false; }
      } catch (error) {
        if (error instanceof GiftError || error instanceof ShopOAuthError) { res.status(error.status).json({ error: error.message, ...(session ? { state: service.view(session) } : {}) }); return; }
        if (error instanceof ShopMcpError) {
          const catalogRequest = path === '/search' || path === '/product';
          const message = error.code === 'shop_invalid_country' ? error.message
            : error.code === 'shop_access_denied' ? 'Your Shop connection needs attention. Reconnect Shop when ready.'
            : catalogRequest ? `Shop product ${path === '/search' ? 'search' : 'lookup'} ${error.code === 'shop_timeout' ? 'timed out' : 'is temporarily unavailable'}. Try again later.`
            : `${error.message} Refresh the status before retrying a cart or checkout.`;
          res.status(error.status).json({ error: message, code: error.code, ...(session ? { state: service.view(session) } : {}) });
          return;
        }
        res.status(502).json({ error: 'Shop gifting is temporarily unavailable. Refresh the status before trying another purchase.', ...(session ? { state: service.view(session) } : {}) });
      }
    });
  };
  route('post', '/session', session => service.view(session));
  route('post', '/connect', session => service.connect(session));
  route('post', '/connection/poll', session => service.poll(session));
  route('post', '/disconnect', session => { delete session.connection; delete session.token; delete session.tokenExpiresAt; return service.view(session); });
  route('get', '/state', session => service.view(session));
  route('post', '/search', (session, body) => service.search(session, text(body.roomId, 64), text(body.query)));
  route('post', '/product', (session, body) => service.product(session, text(body.roomId, 64), text(body.productId), selection(body.selected)));
  route('post', '/cart/add', (session, body) => service.add(session, text(body.roomId, 64), text(body.productId), text(body.variantId), selection(body.selected)));
  route('post', '/cart/quantity', (session, body) => {
    if (!Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 20) throw new GiftError('Quantity must be 0 to 20.');
    return service.quantity(session, text(body.lineId), body.quantity);
  });
  route('post', '/checkout', session => service.checkout(session));
  route('post', '/delivery', (session, body) => {
    if (!/^\d{1,2}$/.test(body.methodKey) || !/^\d{1,2}$/.test(body.groupKey)) throw new GiftError('Invalid delivery choice.');
    return service.delivery(session, body.methodKey, body.groupKey, text(body.optionKey));
  });
  route('post', '/complete', (session, body) => {
    if (body.confirm !== true) throw new GiftError('Confirm the merchant, items, quantities, total, recipient and payment method first.');
    return service.complete(session, text(body.reviewId), text(body.instrumentKey));
  });
  route('post', '/refresh', session => service.refresh(session));
  route('post', '/handoff', session => service.handoff(session));
  route('post', '/clear', session => service.clear(session));
  return router;
}
