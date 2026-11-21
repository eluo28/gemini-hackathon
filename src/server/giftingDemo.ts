import type { ShopMcpClient } from './shopMcp';
import { createGiftingService, type Doc } from './gifting';
import type { GiftAlert } from '../shared/gifting';

/** Explicit local-only fixtures. Never contact Shop or submit payment. */
export function createDemoGiftingService(confirmed: (alert: GiftAlert) => void) {
  const carts = new Map<string, Doc>(), checkouts = new Map<string, Doc>();
  const attempts = new Set<string>();
  const total = (doc: Doc) => {
    const amount = doc.line_items.reduce((sum: number, line: Doc) => sum + line.quantity * 1500, 0);
    doc.totals = [{ type: 'subtotal', display_text: 'Items', amount }, ...(doc.fulfillment ? [{ type: 'fulfillment', display_text: 'Delivery', amount: 500 }] : []), { type: 'total', display_text: 'Total', amount: amount + (doc.fulfillment ? 500 : 0) }];
    return doc;
  };
  const product = (selected: {name:string;label:string}[] = []) => {
    const color = selected.find(option => option.name === 'Color')?.label || 'Blue';
    return { id: 'demo-product', title: 'Demo ceramic mug', options: [{ name: 'Color', values: [{ label: 'Blue' }, { label: 'White' }] }],
      variants: [{ id: `demo-variant-${color.toLowerCase()}`, options: [{ name: 'Color', label: color }], url: 'https://example.invalid/demo-mug', seller: { domain: 'demo.example.invalid', name: 'Local demo store' }, price: { amount: 1500, currency: 'USD' }, availability: { available: true } }] };
  };
  const mcp: ShopMcpClient = { async call(tool, args) {
    const a = args as Doc;
    if (tool === 'search_catalog') return { products: [product()], messages: [] };
    if (tool === 'get_product') return { product: product(a.catalog.selected), messages: [] };
    if (tool === 'get_account') return {};
    if (tool === 'create_cart') {
      const id = `demo-cart-${crypto.randomUUID()}`;
      const doc = total({ ...a.cart, id, currency: 'USD', line_items: a.cart.line_items.map((line: Doc, index: number) => ({ ...line, id: `line-${index}`, item: { ...line.item, title: 'Demo ceramic mug', options: [{ name: 'Color', label: line.item.id.endsWith('white') ? 'White' : 'Blue' }] } })), messages: [] });
      carts.set(id, doc); return structuredClone(doc);
    }
    if (tool === 'get_cart') return structuredClone(carts.get(a.id)!);
    if (tool === 'update_cart') {
      const doc = total({ ...a.cart, line_items: a.cart.line_items.map((line: Doc, index: number) => ({ ...line, id: line.id || `line-${index}`, item: { ...line.item, title: 'Demo ceramic mug' } })) });
      carts.set(a.id, doc); return structuredClone(doc);
    }
    if (tool === 'create_checkout') {
      const cart = carts.get(a.checkout.cart_id)!;
      const doc = total({ ...structuredClone(cart), id: `demo-checkout-${crypto.randomUUID()}`, status: 'ready_for_complete', fulfillment: structuredClone(a.checkout.fulfillment), payment: { instruments: [{ id: 'demo-card', type: 'demo', handler_id: 'demo', display: { label: 'Demo card · no charge' }, credential: { type: 'demo-only', token: 'not-a-real-payment' } }] }, links: [], messages: [] });
      doc.fulfillment.methods[0].line_item_ids = doc.line_items.map((line: Doc) => line.id);
      doc.fulfillment.methods[0].groups = [{ id: 'shipping', selected_option_id: 'standard', options: [{ id: 'standard', title: 'Demo standard shipping', amount: 500 }] }];
      checkouts.set(doc.id, doc); return structuredClone(doc);
    }
    if (tool === 'get_checkout') return structuredClone(checkouts.get(a.id)!);
    if (tool === 'update_checkout') { const doc = total(a.checkout); checkouts.set(a.id, doc); return structuredClone(doc); }
    if (tool === 'complete_checkout') {
      const doc = checkouts.get(a.id)!;
      doc.status = 'completed'; doc.order = { id: `demo-order-${crypto.randomUUID()}` };
      return structuredClone(doc);
    }
    throw new Error('Unsupported demo tool');
  } };
  return createGiftingService({ mcp, simulated: true, ledger: { has: key => attempts.has(key), mark: key => { attempts.add(key); } }, confirmed });
}
