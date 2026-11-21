import express from 'express';
import { createItemDetector, ItemDetectionError, parseItemFrames } from './itemDetection';

export function createItemDetectionRouter(detect = createItemDetector()) {
  const router = express.Router();
  const requests = new Map<string, { started: number; count: number }>();
  let active = 0;
  router.post('/detect-items', express.json({ limit: '2mb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const frames = parseItemFrames(req.body);
      const now = Date.now();
      for (const [key, value] of requests) if (now - value.started >= 60_000) requests.delete(key);
      const key = req.ip || 'unknown';
      const bucket = requests.get(key) || { started: now, count: 0 };
      if (bucket.count >= 5 || active >= 2 || (!requests.has(key) && requests.size >= 1000)) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'Too many item analyses. Please wait a minute.', code: 'item_detection_busy' });
        return;
      }
      bucket.count++; requests.set(key, bucket); active++;
      try { res.json(await detect(frames)); }
      finally { active--; }
    } catch (error) {
      if (error instanceof ItemDetectionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      res.status(502).json({ error: 'Item analysis is unavailable.', code: 'gemini_unavailable' });
    }
  });
  return router;
}
