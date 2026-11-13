// Pruebas del Worker con un KV en memoria y la API de Mercado Pago simulada.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../worker/index.js';
import { paymentMatches, verifyWebhookSignature } from '../worker/lib.js';

const PDF = new TextEncoder().encode('%PDF-1.4 recetario de prueba');
const ORIGIN = 'https://tienda.example.pe';

function memoryKV() {
  const m = new Map();
  const toStream = (v) => new Response(v).body;
  return {
    m,
    async get(key, opt) {
      if (!m.has(key)) return null;
      const { value } = m.get(key);
      const type = typeof opt === 'string' ? opt : opt && opt.type;
      if (type === 'json') return JSON.parse(value);
      if (type === 'stream') return toStream(value);
      return typeof value === 'string' ? value : new TextDecoder().decode(value);
    },
    async getWithMetadata(key, opt) {
      if (!m.has(key)) return { value: null, metadata: null };
      return { value: await this.get(key, opt), metadata: m.get(key).metadata || null };
    },
    async put(key, value, opts = {}) { m.set(key, { value, metadata: opts.metadata }); },
  };
}

let env; let mp;
beforeEach(() => {
  mp = { payments: new Map(), preferences: [] };
  env = {
    KV: memoryKV(),
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    PAYMENT_MODE: 'mercadopago',
    PRICE_PEN: '29.90',
    DOWNLOAD_MAX: '2',
    DOWNLOAD_TTL_HOURS: '72',
    MP_ACCESS_TOKEN: 'TEST-token',
    MP_WEBHOOK_SECRET: 'secreto-webhook',
    DOWNLOAD_SECRET: 'secreto-descargas',
    PDF_KV_KEY: 'file:recetario.pdf',
  };
  env.KV.put('file:recetario.pdf', PDF, { metadata: { size: PDF.length } });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.mercadopago.com', `fetch inesperado a ${url}`);
    assert.equal(init.headers.Authorization, 'Bearer TEST-token');
    if (u.pathname === '/checkout/preferences') {
      const body = JSON.parse(init.body);
      mp.preferences.push(body);
      return Response.json({ id: 'pref-1', init_point: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref-1' });
    }
    const pm = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (pm && mp.payments.has(pm[1])) return Response.json(mp.payments.get(pm[1]));
    return Response.json({ message: 'not found' }, { status: 404 });
  };
});

const call = (path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env);
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function checkout(email = 'Cliente@Ejemplo.pe') {
  const r = await post('/api/checkout', { email, name: 'Ana' });
  assert.equal(r.status, 200);
  return r.json();
}

function approve(orderId, id = '1234567890', extra = {}) {
  mp.payments.set(id, { id: Number(id), status: 'approved', external_reference: orderId, currency_id: 'PEN', transaction_amount: 29.9, metadata: { email: 'cliente@ejemplo.pe' }, ...extra });
  return id;
}

test('checkout crea la preferencia de Mercado Pago correcta', async () => {
  const { orderId, redirectUrl } = await checkout();
  assert.match(redirectUrl, /^https:\/\/www\.mercadopago\.com\.pe\//);
  const pref = mp.preferences[0];
  assert.equal(pref.external_reference, orderId);
  assert.equal(pref.items[0].unit_price, 29.9);
  assert.equal(pref.items[0].currency_id, 'PEN');
  assert.equal(pref.payer.email, 'cliente@ejemplo.pe');
  assert.equal(pref.back_urls.success, `${ORIGIN}/gracias?pedido=${orderId}`);
  assert.equal(pref.notification_url, `${ORIGIN}/api/webhooks/mercadopago?source_news=webhooks`);
});

test('checkout rechaza correos inválidos', async () => {
  assert.equal((await post('/api/checkout', { email: 'no-es-correo' })).status, 400);
});

test('sin pago aprobado no hay descarga', async () => {
  const { orderId } = await checkout();
  approve(orderId, '111', { status: 'pending' });
  const st = await (await call(`/api/pedidos/${orderId}?payment_id=111`)).json();
  assert.equal(st.status, 'pending');
  assert.equal(st.lastPaymentStatus, 'pending');
  assert.equal(st.download, undefined);
});

test('flujo completo: pago aprobado al volver de MP → descarga limitada', async () => {
  const { orderId } = await checkout();
  const pid = approve(orderId);
  const st = await (await call(`/api/pedidos/${orderId}?payment_id=${pid}`)).json();
  assert.equal(st.status, 'paid');
  assert.match(st.download.url, /^\/descargar\/[\w-]{40,}$/);

  const d1 = await call(st.download.url);
  assert.equal(d1.status, 200);
  assert.equal(d1.headers.get('content-type'), 'application/pdf');
  assert.match(d1.headers.get('content-disposition'), /attachment/);
  assert.equal(d1.headers.get('content-length'), String(PDF.length));
  assert.equal(await d1.text(), '%PDF-1.4 recetario de prueba');
  assert.equal((await call(st.download.url)).status, 200);
  assert.equal((await call(st.download.url)).status, 410, 'límite de descargas');
  assert.equal((await call('/descargar/' + crypto.randomBytes(32).toString('base64url'))).status, 404);
});

test('un pago de otro pedido, monto o moneda no libera la descarga', async () => {
  const { orderId } = await checkout();
  const other = crypto.randomUUID();
  approve(other, '201');
  let st = await (await call(`/api/pedidos/${orderId}?payment_id=201`)).json();
  assert.equal(st.status, 'pending');
  approve(orderId, '202', { transaction_amount: 1 });
  st = await (await call(`/api/pedidos/${orderId}?payment_id=202`)).json();
  assert.equal(st.status, 'pending');
  approve(orderId, '203', { currency_id: 'USD' });
  st = await (await call(`/api/pedidos/${orderId}?payment_id=203`)).json();
  assert.equal(st.status, 'pending');
});

test('webhook firmado confirma el pago; firma inválida → 401', async () => {
  const { orderId } = await checkout();
  const pid = approve(orderId, '987654321');
  const ts = String(Date.now());
  const reqId = 'req-abc';
  const v1 = crypto.createHmac('sha256', 'secreto-webhook').update(`id:${pid};request-id:${reqId};ts:${ts};`).digest('hex');
  const bad = await post(`/api/webhooks/mercadopago?data.id=${pid}&type=payment`, { type: 'payment', data: { id: pid } }, { 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}`, 'x-request-id': reqId });
  assert.equal(bad.status, 401);
  const ok = await post(`/api/webhooks/mercadopago?data.id=${pid}&type=payment`, { type: 'payment', data: { id: pid } }, { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': reqId });
  assert.equal(ok.status, 200);
  const st = await (await call(`/api/pedidos/${orderId}`)).json();
  assert.equal(st.status, 'paid');
});

test('webhook antes de que el pedido exista en KV reconstruye el pedido desde el pago', async () => {
  const orderId = crypto.randomUUID();
  const pid = approve(orderId, '555');
  env.MP_WEBHOOK_SECRET = '';
  const r = await post(`/api/webhooks/mercadopago?data.id=${pid}&type=payment`, { type: 'payment', data: { id: pid } });
  assert.equal(r.status, 200);
  const st = await (await call(`/api/pedidos/${orderId}`)).json();
  assert.equal(st.status, 'paid');
});

test('enlace vencido devuelve 410', async () => {
  const { orderId } = await checkout();
  approve(orderId, '777');
  const st = await (await call(`/api/pedidos/${orderId}?payment_id=777`)).json();
  const key = `order:${orderId}`;
  const order = JSON.parse(env.KV.m.get(key).value);
  order.download.expiresAt = new Date(Date.now() - 1000).toISOString();
  env.KV.m.get(key).value = JSON.stringify(order);
  assert.equal((await call(st.download.url)).status, 410);
});

test('modo demo solo funciona en localhost', async () => {
  env.PAYMENT_MODE = 'demo';
  assert.equal((await post('/api/checkout', { email: 'a@b.pe' })).status, 403);
  const local = await worker.fetch(new Request('http://localhost:8787/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.pe' }) }), env);
  assert.equal(local.status, 200);
});

test('reglas de verificación de pagos y firmas', async () => {
  const base = { status: 'approved', external_reference: 'abc', currency_id: 'PEN', transaction_amount: 29.9 };
  assert.ok(paymentMatches(base, { orderId: 'abc', amount: 29.9 }));
  assert.ok(!paymentMatches({ ...base, status: 'in_process' }, { orderId: 'abc', amount: 29.9 }));
  assert.ok(!(await verifyWebhookSignature('s', { signature: '', requestId: 'x', dataId: '1' })).ok);
});
