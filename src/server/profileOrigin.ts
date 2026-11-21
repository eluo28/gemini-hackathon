import type { RequestHandler } from 'express';

function httpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

/** Browser Fetch Metadata survives proxies that rewrite scheme and Host. */
export function requireProfileOrigin(appUrl = process.env.APP_URL): RequestHandler {
  return (req, res, next) => {
    const rawOrigin = req.get('origin');
    const origin = httpOrigin(rawOrigin);
    // Origin headers must be serialized origins, not paths or opaque "null".
    const validOrigin = origin !== null && rawOrigin === origin;
    const configuredOrigin = httpOrigin(appUrl);
    const directOrigin = httpOrigin(`${req.protocol}://${req.get('host')}`);
    // Sec-Fetch-* headers are browser-controlled: cross-origin scripts cannot
    // set same-origin. Unlike X-Forwarded-*, no global proxy trust is required.
    const browserSameOrigin = req.get('sec-fetch-site') === 'same-origin';
    if (validOrigin && (origin === configuredOrigin || origin === directOrigin || browserSameOrigin)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Profile changes must come from this app.' });
  };
}
