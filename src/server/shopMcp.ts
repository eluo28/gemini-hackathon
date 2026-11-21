import crypto from 'node:crypto';

const ENDPOINT = 'https://mcp.shop.com/';
const PROTOCOL_VERSION = '2026-07-28';
export type CatalogTool = 'search_catalog' | 'lookup_catalog' | 'get_product';
export type ShopDocument = Record<string, unknown>;

export class ShopMcpError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super('Shop could not complete this request.');
  }
}

/** Fixed-destination, server-only MCP transport. Never retries a request. */
export function createShopMcpClient(fetcher: typeof fetch = fetch, timeoutMs = 12_000) {
  return {
    async call(tool: CatalogTool, args: ShopDocument): Promise<ShopDocument> {
      const requestId = crypto.randomUUID();
      let response: Response;
      try {
        response = await fetcher(ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': PROTOCOL_VERSION,
            'Mcp-Method': 'tools/call',
            'Mcp-Name': tool,
          },
          body: JSON.stringify({
            jsonrpc: '2.0', id: requestId, method: 'tools/call',
            params: {
              name: tool, arguments: args,
              _meta: {
                'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
                'io.modelcontextprotocol/clientInfo': { name: 'clipthat', version: '1.0.0' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });
      } catch (error) {
        if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
          throw new ShopMcpError('shop_timeout', 504);
        }
        throw new ShopMcpError('shop_unavailable', 502);
      }
      if (!response.ok) {
        const status = response.status;
        if (status === 429) throw new ShopMcpError('shop_rate_limited', 429);
        if (status === 401 || status === 403) throw new ShopMcpError('shop_access_denied', 502);
        throw new ShopMcpError('shop_unavailable', 502);
      }
      let envelope;
      try { envelope = await response.json(); }
      catch { throw new ShopMcpError('shop_invalid_response', 502); }
      if (envelope?.error || envelope?.result?.isError) {
        throw new ShopMcpError('shop_tool_error', 502);
      }
      const document = envelope?.result?.structuredContent;
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new ShopMcpError('shop_invalid_response', 502);
      }
      // Preserve merchant warnings, exact IDs, URLs, currencies and pagination.
      return document;
    },
  };
}

export type ShopMcpClient = ReturnType<typeof createShopMcpClient>;
