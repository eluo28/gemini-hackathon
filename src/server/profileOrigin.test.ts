import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { requireProfileOrigin } from './profileOrigin';

test('profile origin guard accepts browser same-origin saves through an HTTPS hosting proxy', async t => {
  const app = express();
  app.post('/profile', requireProfileOrigin('https://public.example/app/'), (_req, res) => res.json({ accepted: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (headers: Record<string, string>) => fetch(base + '/profile', { method: 'POST', headers });

  // Reproduce the original bug: Express sees HTTP + an internal Host while
  // the browser correctly identifies its own public HTTPS origin.
  const proxyHeaders = { Origin: 'https://clipcast-studio.ai.studio', Host: 'internal-service:3000', 'Sec-Fetch-Site': 'same-origin' };
  assert.notEqual(proxyHeaders.Origin, `http://${proxyHeaders.Host}`);
  assert.equal((await post(proxyHeaders)).status, 200);
  assert.equal((await post({ Origin: 'https://public.example' })).status, 200);
  assert.equal((await post({ Origin: base })).status, 200);

  const denied: Record<string, string>[] = [
    { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://other.public.example', 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' },
    { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
    { Origin: 'https://public.example/forged-path' },
    {},
  ];
  for (const headers of denied) assert.equal((await post(headers)).status, 403);
});
