import { Router } from 'express';
import { createShopMcpClient, ShopMcpError, type CatalogTool, type ShopMcpClient } from './shopMcp';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
class InputError extends Error {}
function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`Invalid ${name}.`);
  return value;
}
function validateCatalog(tool: CatalogTool, input: unknown) {
  if (!object(input) || !object(input.catalog)) throw new InputError('Expected a catalog object.');
  const catalog = input.catalog;
  const allowed = new Set(['context', 'filters', ...(tool === 'search_catalog' ? ['query', 'pagination'] : tool === 'lookup_catalog' ? ['ids'] : ['id', 'selected'])]);
  if (Object.keys(catalog).some(key => !allowed.has(key))) throw new InputError('Unsupported catalog field.');
  if (tool === 'search_catalog') text(catalog.query, 'query');
  if (tool === 'lookup_catalog') {
    if (!Array.isArray(catalog.ids) || catalog.ids.length < 1 || catalog.ids.length > 50) throw new InputError('Supply 1 to 50 public product URLs or identifiers.');
    for (const id of catalog.ids) {
      text(id, 'identifier', 2048);
      if (/^https?:/i.test(id)) {
        let url: URL;
        try { url = new URL(id); } catch { throw new InputError('Invalid public product URL.'); }
        if (url.username || url.password || /\/(?:cart|checkouts?|account)(?:\/|$)/i.test(url.pathname) || /(?:token|signature|key|auth|secret)/i.test(url.search)) {
          throw new InputError('Use public product URLs, not private cart, checkout, account, or signed URLs.');
        }
      }
    }
  }
  if (tool === 'get_product') {
    text(catalog.id, 'product ID');
    if (catalog.selected !== undefined) {
      if (!Array.isArray(catalog.selected) || catalog.selected.length > 20) throw new InputError('Invalid selected options.');
      for (const selection of catalog.selected) {
        if (!object(selection)) throw new InputError('Invalid selected option.');
        text(selection.name, 'option name', 100); text(selection.label, 'option label', 100);
      }
    }
  }
  if (catalog.context !== undefined) {
    if (!object(catalog.context)) throw new InputError('Invalid context.');
    const ctx = catalog.context;
    if (Object.keys(ctx).some(key => !['address_country', 'address_region', 'postal_code', 'currency'].includes(key))) throw new InputError('Unsupported context field.');
    for (const [key, value] of Object.entries(ctx)) text(value, key, 100);
    if (ctx.address_country && !/^[A-Z]{2}$/.test(String(ctx.address_country))) throw new InputError('Use a two-letter country code.');
    if (ctx.currency && !/^[A-Z]{3}$/.test(String(ctx.currency))) throw new InputError('Use a three-letter currency code.');
  }
  if (catalog.pagination !== undefined) {
    if (!object(catalog.pagination)) throw new InputError('Invalid pagination.');
    const { limit, cursor } = catalog.pagination;
    if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50)) throw new InputError('Limit must be 1 to 50.');
    if (cursor !== undefined) text(cursor, 'cursor', 4096);
  }
  if (catalog.filters !== undefined) {
    if (!object(catalog.filters)) throw new InputError('Invalid filters.');
    if (Object.keys(catalog.filters).some(key => !['price', 'attributes', 'shops', 'ships_to'].includes(key))) throw new InputError('Unsupported filter.');
    const { price, attributes, shops, ships_to } = catalog.filters;
    if (price !== undefined) {
      if (!object(price) || Object.keys(price).some(key => !['min', 'max'].includes(key)) || Object.values(price).some(value => !Number.isSafeInteger(value) || Number(value) < 0)) throw new InputError('Price bounds must be nonnegative integers in minor currency units.');
      if (!object(catalog.context) || !catalog.context.currency) throw new InputError('Price filters require context.currency.');
      if (price.min !== undefined && price.max !== undefined && Number(price.min) > Number(price.max)) throw new InputError('Minimum price exceeds maximum.');
    }
    if (attributes !== undefined) {
      if (!Array.isArray(attributes) || attributes.length > 20) throw new InputError('Invalid attributes.');
      for (const attribute of attributes) {
        if (!object(attribute) || !Array.isArray(attribute.values) || !attribute.values.length || attribute.values.length > 50) throw new InputError('Invalid attribute.');
        text(attribute.name, 'attribute name', 100);
        for (const value of attribute.values) text(value, 'attribute value', 100);
      }
    }
    if (shops !== undefined) {
      if (!Array.isArray(shops) || !shops.length || shops.length > 50) throw new InputError('Invalid shops.');
      for (const shop of shops) text(shop, 'shop', 255);
    }
    if (ships_to !== undefined) {
      if (!object(ships_to) || !/^[A-Z]{2}$/.test(String(ships_to.country))) throw new InputError('Invalid shipping country.');
      if (ships_to.region !== undefined) text(ships_to.region, 'region', 100);
      if (ships_to.postal_code !== undefined) text(ships_to.postal_code, 'postal code', 100);
    }
  }
  return { catalog };
}

export function createShopRouter(client: ShopMcpClient = createShopMcpClient()) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const routes = { '/search': 'search_catalog', '/lookup': 'lookup_catalog', '/product': 'get_product' } as const;
  for (const [route, tool] of Object.entries(routes)) {
    router.post(route, async (req, res) => {
      try {
        const args = validateCatalog(tool, req.body);
        res.json(await client.call(tool, args));
      } catch (error) {
        if (error instanceof InputError) { res.status(400).json({ error: error.message }); return; }
        if (error instanceof ShopMcpError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
        res.status(502).json({ error: 'Shop is temporarily unavailable.', code: 'shop_unavailable' });
      }
    });
  }
  return router;
}
