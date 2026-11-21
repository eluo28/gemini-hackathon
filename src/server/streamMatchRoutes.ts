import express from 'express';
import { parseItemFrames, ItemDetectionError } from './itemDetection';
import { requireProfileOrigin } from './profileOrigin';
import { createShopMcpClient, ShopMcpError, type ShopMcpClient } from './shopMcp';
import { productsFrom, messagesFrom } from './gifting';

export function createStreamMatchRouter(mcp: ShopMcpClient = createShopMcpClient()) {
  const router = express.Router();
  const limits = new Map<string, { started: number; count: number }>();
  router.post('/match-stream-item', requireProfileOrigin(), express.json({ limit: '1mb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const [frame] = parseItemFrames({ frames: [req.body.image] });
      const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
      if (!query || query.length > 500) { res.status(400).json({ error: 'Invalid item description.' }); return; }
      const now = Date.now(), ip = req.ip || 'unknown';
      for (const [key, limit] of limits) if (now - limit.started >= 60_000) limits.delete(key);
      const limit = limits.get(ip) || { started: now, count: 0 };
      if (limit.count >= 10 || (!limits.has(ip) && limits.size >= 1000)) { res.status(429).json({ error: 'Too many product lookups. Wait a minute before asking again.' }); return; }
      limit.count++; limits.set(ip, limit);
      const result = await mcp.call('search_catalog', { catalog: {
        query, like: { image: { content_type: frame.mimeType, data: frame.data } }, pagination: { limit: 3 },
      } });
      // No catalog caching or image rehosting. Only project this lookup's result.
      res.json({ products: productsFrom(result), messages: messagesFrom(result) });
    } catch (error) {
      if (error instanceof ItemDetectionError) { res.status(error.status).json({ error: error.message }); return; }
      if (error instanceof ShopMcpError) { res.status(error.status).json({ error: error.code === 'shop_rate_limited' ? 'Shop is rate limiting product matches. Try again later.' : 'Shop could not find products right now. Try asking again later.', code: error.code }); return; }
      res.status(502).json({ error: 'Product matching is temporarily unavailable.' });
    }
  });
  return router;
}
