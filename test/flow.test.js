'use strict';
// Pruebas de extremo a extremo del flujo de compra en modo demo y de la
// verificación de pagos/webhooks de Mercado Pago.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aji-test-'));
const pdf = path.join(tmp, 'recetario.pdf');
fs.writeFileSync(pdf, '%PDF-1.4 test');
Object.assign(process.env, {
  PAYMENT_MODE: 'demo', DATA_DIR: path.join(tmp, 'data'), PDF_PATH: pdf, DOWNLOAD_MAX: '2',
  PRICE_PEN: '29.90', MP_WEBHOOK_SECRET: 'secreto-de-prueba', NODE_ENV: 'test',
});

const app = require('../server');
const mp = require('../src/payments/mercadopago');
const store = require('../src/store');
let server; let base;

before(async () => {
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await store.persist(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('la landing se sirve con precio y sin placeholders', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /S\/ 29\.90/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /<x-img/);
  assert.match(html, /<picture>/);
});

test('el PDF y los datos no son accesibles públicamente', async () => {
  for (const p of ['/private/recetario-100-recetas-peruanas.pdf', '/data/orders.json', '/recetario.pdf', '/server.js', '/.env']) {
    const r = await fetch(base + p);
    assert.notStrictEqual(r.status, 200, p);
  }
});

test('checkout rechaza correos inválidos', async () => {
  const r = await post('/api/checkout', { email: 'no-es-correo' });
  assert.strictEqual(r.status, 400);
});

test('flujo completo: pedido → sin pago no hay descarga → pago → descarga limitada', async () => {
  const r = await post('/api/checkout', { email: 'Cliente@Ejemplo.com', name: 'Ana' });
  assert.strictEqual(r.status, 200);
  const { orderId, redirectUrl } = await r.json();
  assert.match(redirectUrl, /^\/demo\/pagar\//);

  let st = await (await fetch(`${base}/api/pedidos/${orderId}`)).json();
  assert.strictEqual(st.status, 'pending');
  assert.strictEqual(st.download, undefined);

  const pay = await fetch(base + redirectUrl, { method: 'POST', body: new URLSearchParams({ r: 'approved' }), redirect: 'manual' });
  assert.strictEqual(pay.status, 302);

  st = await (await fetch(`${base}/api/pedidos/${orderId}`)).json();
  assert.strictEqual(st.status, 'paid');
  assert.match(st.download.url, /^\/descargar\/[\w-]{40,}$/);

  const d1 = await fetch(base + st.download.url);
  assert.strictEqual(d1.status, 200);
  assert.strictEqual(d1.headers.get('content-type'), 'application/pdf');
  assert.match(d1.headers.get('content-disposition'), /attachment/);
  assert.strictEqual(await d1.text(), '%PDF-1.4 test');
  assert.strictEqual((await fetch(base + st.download.url)).status, 200);
  assert.strictEqual((await fetch(base + st.download.url)).status, 410, 'límite de descargas');

  // Un token inventado no sirve.
  assert.strictEqual((await fetch(base + '/descargar/' + crypto.randomBytes(32).toString('base64url'))).status, 404);
});

test('enlace vencido devuelve 410', async () => {
  const o = store.createOrder({ email: 'v@ejemplo.com' });
  const { token } = store.markPaid(o.id, '123');
  store.getOrder(o.id).download.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual((await fetch(`${base}/descargar/${token}`)).status, 410);
});

test('solo un pago aprobado, del pedido, monto y moneda correctos habilita la descarga', () => {
  const order = { id: 'abc', amount: 29.9, currency: 'PEN' };
  const ok = { status: 'approved', external_reference: 'abc', currency_id: 'PEN', transaction_amount: 29.9 };
  assert.ok(mp.paymentMatchesOrder(ok, order));
  assert.ok(!mp.paymentMatchesOrder({ ...ok, status: 'pending' }, order));
  assert.ok(!mp.paymentMatchesOrder({ ...ok, status: 'in_process' }, order));
  assert.ok(!mp.paymentMatchesOrder({ ...ok, external_reference: 'otro' }, order));
  assert.ok(!mp.paymentMatchesOrder({ ...ok, transaction_amount: 1 }, order));
  assert.ok(!mp.paymentMatchesOrder({ ...ok, currency_id: 'USD' }, order));
});

test('firma x-signature del webhook', async () => {
  const ts = String(Date.now());
  const reqId = 'req-123';
  const dataId = '987654321';
  const v1 = crypto.createHmac('sha256', 'secreto-de-prueba').update(`id:${dataId};request-id:${reqId};ts:${ts};`).digest('hex');
  const fake = (sig) => ({ get: (h) => ({ 'x-signature': sig, 'x-request-id': reqId })[h], query: { 'data.id': dataId }, body: {} });
  assert.ok(mp.verifyWebhookSignature(fake(`ts=${ts},v1=${v1}`)).ok);
  assert.ok(!mp.verifyWebhookSignature(fake(`ts=${ts},v1=${'0'.repeat(64)}`)).ok);
  assert.ok(!mp.verifyWebhookSignature(fake('')).ok);

  const r = await fetch(`${base}/api/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=bad`, 'x-request-id': reqId },
    body: JSON.stringify({ type: 'payment', data: { id: dataId } }),
  });
  assert.strictEqual(r.status, 401);
});
