// Lógica compartida del Worker: configuración, pedidos en KV, tokens de
// descarga, Mercado Pago y correo. Solo usa APIs web estándar (fetch,
// crypto.subtle), por lo que también se puede probar con Node 22.

const enc = new TextEncoder();

// ---------- Configuración ----------
export function cfg(env) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const price = Math.round(num(env.PRICE_PEN, 29.9) * 100) / 100;
  return {
    mode: env.PAYMENT_MODE || 'mercadopago',
    productId: env.PRODUCT_ID || 'recetario-100-recetas-peruanas',
    productName: env.PRODUCT_NAME || 'Recetario Ají Tradición: 100 recetas peruanas',
    price,
    currency: 'PEN',
    pdfKey: env.PDF_KV_KEY || 'file:recetario-100-recetas-peruanas.pdf',
    pdfName: env.PDF_DOWNLOAD_NAME || 'Aji-Tradicion-100-recetas-peruanas.pdf',
    ttlHours: num(env.DOWNLOAD_TTL_HOURS, 72),
    maxDownloads: num(env.DOWNLOAD_MAX, 5),
    statementDescriptor: (env.MP_STATEMENT_DESCRIPTOR || 'AJITRADICION').slice(0, 22),
    contactEmail: env.CONTACT_EMAIL || 'hola@example.com',
    mailFrom: env.MAIL_FROM || '',
    mpToken: env.MP_ACCESS_TOKEN || '',
    mpWebhookSecret: env.MP_WEBHOOK_SECRET || '',
    downloadSecret: env.DOWNLOAD_SECRET || '',
    resendKey: env.RESEND_API_KEY || '',
  };
}

// ---------- Utilidades ----------
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PAYMENT_ID_RE = /^\d{1,20}$/;

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

// ---------- Pedidos (Workers KV) ----------
// order:<id>   → pedido (JSON)
// tok:<hash>   → id del pedido (índice de enlaces de descarga)
// email:<mail> → id del último pedido pagado de ese correo
const ORDER_TTL = 60 * 60 * 24 * 400; // los pedidos se conservan ~13 meses

export async function getOrder(env, id) {
  if (!UUID_RE.test(id)) return null;
  return env.KV.get(`order:${id}`, 'json');
}

export async function putOrder(env, order) {
  await env.KV.put(`order:${order.id}`, JSON.stringify(order), { expirationTtl: ORDER_TTL });
  return order;
}

export async function createOrder(env, { email, name }) {
  const c = cfg(env);
  return putOrder(env, {
    id: crypto.randomUUID(),
    email,
    name: name || '',
    amount: c.price,
    currency: c.currency,
    status: 'pending',
    paymentId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
    download: null,
    emailSentAt: null,
  });
}

/** El token se deriva con HMAC, así puede mostrarse de nuevo sin guardarlo en claro. */
export async function tokenFor(env, order) {
  const c = cfg(env);
  if (!c.downloadSecret) throw new Error('Falta el secreto DOWNLOAD_SECRET.');
  if (!order.download) return null;
  return b64url(await hmac(c.downloadSecret, `${order.id}.${order.download.nonce}`));
}

/** Emite un enlace de descarga nuevo (el anterior deja de funcionar). */
export async function issueDownload(env, order) {
  const c = cfg(env);
  order.download = {
    nonce: randomHex(16),
    expiresAt: new Date(Date.now() + c.ttlHours * 3600e3).toISOString(),
    count: 0,
  };
  const token = await tokenFor(env, order);
  order.download.tokenHash = await sha256Hex(token);
  await env.KV.put(`tok:${order.download.tokenHash}`, order.id, { expirationTtl: Math.ceil(c.ttlHours * 3600 + 86400) });
  await putOrder(env, order);
  return token;
}

export async function findByToken(env, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const h = await sha256Hex(token);
  const id = await env.KV.get(`tok:${h}`);
  if (!id) return null;
  const order = await getOrder(env, id);
  // Un enlace reemplazado por uno más nuevo ya no es válido.
  return order && order.download && order.download.tokenHash === h ? order : null;
}

export async function publicOrder(env, order) {
  const c = cfg(env);
  const out = { id: order.id, status: order.status, amount: order.amount, currency: order.currency, lastPaymentStatus: order.lastPaymentStatus || null };
  if (order.status === 'paid' && order.download) {
    out.download = {
      url: `/descargar/${await tokenFor(env, order)}`,
      expiresAt: order.download.expiresAt,
      remaining: Math.max(0, c.maxDownloads - order.download.count),
    };
    out.emailSent = Boolean(order.emailSentAt);
  }
  return out;
}

// ---------- Mercado Pago ----------
const MP_API = 'https://api.mercadopago.com';

async function mpFetch(env, path, { method = 'GET', body, idempotencyKey } = {}) {
  const c = cfg(env);
  if (!c.mpToken) throw new Error('Falta el secreto MP_ACCESS_TOKEN.');
  const headers = { Authorization: `Bearer ${c.mpToken}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(MP_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Mercado Pago ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

export async function createPreference(env, order, origin) {
  const c = cfg(env);
  const back = `${origin}/gracias?pedido=${order.id}`;
  const pref = await mpFetch(env, '/checkout/preferences', {
    method: 'POST',
    idempotencyKey: order.id,
    body: {
      items: [{
        id: c.productId,
        title: c.productName,
        description: 'Recetario digital en PDF con 100 recetas peruanas.',
        category_id: 'learnings',
        quantity: 1,
        currency_id: c.currency,
        unit_price: order.amount,
      }],
      payer: { email: order.email, ...(order.name ? { name: order.name } : {}) },
      external_reference: order.id,
      metadata: { order_id: order.id, email: order.email },
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      notification_url: `${origin}/api/webhooks/mercadopago?source_news=webhooks`,
      statement_descriptor: c.statementDescriptor,
      expires: true,
      expiration_date_to: new Date(Date.now() + 48 * 3600e3).toISOString(),
    },
  });
  return { redirectUrl: pref.init_point, preferenceId: pref.id };
}

export async function getPayment(env, paymentId) {
  if (!PAYMENT_ID_RE.test(String(paymentId))) throw new Error('payment_id inválido');
  return mpFetch(env, `/v1/payments/${paymentId}`);
}

/** Un pago cuenta solo si está aprobado, es de este pedido, en soles y cubre el precio. */
export function paymentMatches(payment, { orderId, amount, currency = 'PEN' }) {
  return Boolean(
    payment &&
    payment.status === 'approved' &&
    payment.external_reference === orderId &&
    payment.currency_id === currency &&
    Number(payment.transaction_amount) + 0.001 >= Number(amount)
  );
}

/**
 * Valida la cabecera x-signature de los webhooks de Mercado Pago.
 * Manifiesto: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 */
export async function verifyWebhookSignature(secret, { signature, requestId, dataId }) {
  if (!secret) return { ok: true, verified: false };
  const parts = Object.fromEntries(String(signature || '').split(',').map((p) => p.trim().split('=').map((s) => s.trim())));
  if (!parts.ts || !parts.v1) return { ok: false, verified: false };
  let id = String(dataId || '');
  if (/^[a-z0-9]+$/i.test(id)) id = id.toLowerCase();
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = hex(await hmac(secret, manifest));
  const ok = safeEqual(expected, String(parts.v1).toLowerCase());
  return { ok, verified: ok };
}

// ---------- Correo (opcional, vía Resend) ----------
export function mailEnabled(env) {
  const c = cfg(env);
  return Boolean(c.resendKey && c.mailFrom);
}

export async function sendDownloadEmail(env, order, token, origin) {
  const c = cfg(env);
  if (!mailEnabled(env)) return false;
  const link = `${origin}/descargar/${token}`;
  const hi = order.name ? `Hola ${esc(order.name)},` : 'Hola,';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F7F1E6;font-family:Arial,Helvetica,sans-serif;color:#2A1C14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFCF6;border-radius:16px;padding:36px">
<tr><td style="font-family:Georgia,serif;font-size:26px;color:#B23A1E;padding-bottom:4px">Ají Tradición</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding:16px 0">${hi}<br>¡Gracias por tu compra! Tu pago fue confirmado y tu recetario de <strong>100 recetas peruanas</strong> ya está listo.</td></tr>
<tr><td style="padding:8px 0 20px"><a href="${link}" style="display:inline-block;background:#B23A1E;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px">Descargar mi recetario (PDF)</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6B5847">El enlace es personal, vence en ${c.ttlHours} horas y permite hasta ${c.maxDownloads} descargas. Guarda el PDF en tu equipo o en la nube.<br>Pedido: ${esc(order.id)}<br>¿Algún problema? Escríbenos a ${esc(c.contactEmail)}.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${order.name ? `Hola ${order.name},` : 'Hola,'}\n\n¡Gracias por tu compra! Tu pago fue confirmado.\nDescarga tu recetario aquí: ${link}\n\nEl enlace vence en ${c.ttlHours} horas y permite hasta ${c.maxDownloads} descargas.\nPedido: ${order.id}\nSoporte: ${c.contactEmail}\n`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: c.mailFrom, to: [order.email], subject: 'Tu recetario Ají Tradición está listo para descargar', html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}
