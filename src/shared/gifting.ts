export interface GiftMessage { content: string; severity?: string; code?: string; links: { href: string; label: string }[]; images: { url: string; alt: string }[] }
export interface GiftProduct {
  id: string; title: string; image?: string; url: string; shop: string; seller: string;
  variantId: string; options: { name: string; values: string[] }[];
  selected: { name: string; label: string }[]; amount: number; currency: string; available: boolean;
}
export interface GiftAlert { simulated?: boolean; id: string; roomId: string; recipient: string; createdAt: number }
export type PurchaseMode = 'gift' | 'self';
export interface PendingPurchase { shop: string; variantId: string; mode: PurchaseMode }
export interface GiftView {
  notice?: string;
  mode?: PurchaseMode;
  simulated: boolean;
  connected: boolean;
  recipient: string;
  cart: null | { shop: string; lines: { id: string; title: string; quantity: number; options: string; image?: string }[]; totals: { label: string; amount: number }[]; currency: string; continueUrl?: string };
  checkout: null | {
    status: string; handoffOpened: boolean; recipientVerified: boolean; totals: { label: string; amount: number }[]; currency: string;
    instruments: { key: string; label: string }[];
    delivery: { methodKey: string; groupKey: string; selected: string | null; options: { key: string; label: string; amount?: number }[] }[];
    continueUrl?: string; links: { href: string; label: string }[];
    reviewId?: string; completionAttempted: boolean; orderConfirmed: boolean; giftConfirmed: boolean;
  };
  messages: GiftMessage[];
  uncertainWrite: boolean;
}
export interface ShopConnection { url: string; code: string; interval: number; expiresAt: number }
