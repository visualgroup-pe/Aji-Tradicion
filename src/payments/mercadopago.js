'use strict';

// Mercado Pago Checkout Pro integration (Perú, PEN) using the REST API directly.
// Docs: https://www.mercadopago.com.pe/developers/es/docs/checkout-pro/landing

const crypto = require('crypto');
const config = require('../config');

const API = 'https://api.mercadopago.com';

async function mpFetch(pathname, { method = 'GET', body, idempotencyKey } = {}) {
  if (!config.mercadopago.accessToken) {
    throw new Error('Falta MP_ACCESS_TOKEN: configura tus credenciales de Mercado Pago.');
  }
  const headers = {
    Authorization: `Bearer ${config.mercadopago.accessToken}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Mercado Pago ${method} ${pathname} -> ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

/** Creates a Checkout Pro preference and returns the URL to redirect the buyer to. */
async function createCheckout(order) {
  const base = config.baseUrl;
  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    idempotencyKey: order.id,
    body: {
      items: [{
        id: config.product.id,
        title: config.product.name,
        description: 'Recetario digital en PDF con 100 recetas peruanas.',
        category_id: 'learnings',
        quantity: 1,
        currency_id: 'PEN',
        unit_price: order.amount,
      }],
      payer: { email: order.email, ...(order.name ? { name: order.name } : {}) },
      external_reference: order.id,
      back_urls: {
        success: `${base}/gracias?pedido=${order.id}`,
        pending: `${base}/gracias?pedido=${order.id}`,
        failure: `${base}/gracias?pedido=${order.id}`,
      },
      auto_return: 'approved',
      notification_url: `${base}/api/webhooks/mercadopago?source_news=webhooks`,
      statement_descriptor: config.mercadopago.statementDescriptor,
      binary_mode: false,
      metadata: { order_id: order.id },
      // Expire unpaid preferences after 48 h.
      expires: true,
      expiration_date_to: new Date(Date.now() + 48 * 3600e3).toISOString(),
    },
  });
  return { redirectUrl: pref.init_point, preferenceId: pref.id };
}

async function getPayment(paymentId) {
  if (!/^\d{1,20}$/.test(String(paymentId))) throw new Error('payment_id inválido');
  return mpFetch(`/v1/payments/${paymentId}`);
}

/**
 * Checks that a Mercado Pago payment really pays for this order.
 * Only an "approved" payment for the right order, amount and currency counts.
 */
function paymentMatchesOrder(payment, order) {
  return Boolean(
    payment &&
    order &&
    payment.status === 'approved' &&
    payment.external_reference === order.id &&
    payment.currency_id === order.currency &&
    Number(payment.transaction_amount) + 0.001 >= Number(order.amount)
  );
}

/**
 * Validates the x-signature header Mercado Pago sends with webhooks.
 * https://www.mercadopago.com.pe/developers/es/docs/your-integrations/notifications/webhooks
 */
function verifyWebhookSignature(req) {
  const secret = config.mercadopago.webhookSecret;
  if (!secret) {
    // Without a secret we cannot authenticate the notification, but it is still
    // safe: we never trust its body, we always re-fetch the payment from the API.
    return { ok: true, verified: false };
  }
  const header = String(req.get('x-signature') || '');
  const requestId = String(req.get('x-request-id') || '');
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=').map((s) => s.trim())));
  const ts = parts.ts;
  const v1 = parts.v1;
  let dataId = req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || '';
  dataId = String(dataId);
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  if (!ts || !v1) return { ok: false, verified: false };

  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, verified: ok };
}

/** Extracts the payment id from a webhook / IPN notification, if it is about a payment. */
function paymentIdFromNotification(req) {
  const q = req.query || {};
  const b = req.body || {};
  const type = b.type || q.type || q.topic || b.topic;
  if (type && type !== 'payment') return null;
  const id = (b.data && b.data.id) || q['data.id'] || q.id;
  return id && /^\d{1,20}$/.test(String(id)) ? String(id) : null;
}

module.exports = { createCheckout, getPayment, paymentMatchesOrder, verifyWebhookSignature, paymentIdFromNotification };
