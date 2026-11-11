'use strict';

// Minimal persistent order store backed by a JSON file.
// Suitable for a single-instance deployment selling one digital product.
// For several instances, replace it with a database (same interface).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const FILE = path.join(config.dataDir, 'orders.json');

let orders = new Map();
let writing = Promise.resolve();

function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(FILE)) return;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  orders = new Map(raw.map((o) => [o.id, o]));
}

function persist() {
  const snapshot = JSON.stringify([...orders.values()], null, 1);
  writing = writing.then(async () => {
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.promises.rename(tmp, FILE);
  }).catch((err) => console.error('[store] error guardando pedidos:', err));
  return writing;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createOrder({ email, name }) {
  const order = {
    id: crypto.randomUUID(),
    email,
    name: name || '',
    amount: config.product.price,
    currency: config.product.currency,
    status: 'pending', // pending | paid | rejected
    paymentId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
    download: null, // { tokenHash, expiresAt, count }
    emailSentAt: null,
  };
  orders.set(order.id, order);
  persist();
  return order;
}

function getOrder(id) {
  return orders.get(id) || null;
}

function updateOrder(id, patch) {
  const o = orders.get(id);
  if (!o) return null;
  Object.assign(o, patch);
  persist();
  return o;
}

/** Marks an order as paid (idempotent) and issues a fresh download token. */
function markPaid(id, paymentId) {
  const o = orders.get(id);
  if (!o) return { order: null, token: null };
  let token = null;
  if (o.status !== 'paid') {
    o.status = 'paid';
    o.paymentId = String(paymentId);
    o.paidAt = new Date().toISOString();
    token = issueToken(o);
  }
  persist();
  return { order: o, token, isNew: Boolean(token) };
}

// Secret used to derive download tokens. Taken from DOWNLOAD_SECRET or
// generated once and kept in the (private) data directory.
function loadSecret() {
  if (process.env.DOWNLOAD_SECRET) return process.env.DOWNLOAD_SECRET;
  const f = path.join(config.dataDir, '.download-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
let SECRET = null;

/** The download token is derived (HMAC) so it can be shown again on the thank-you page. */
function tokenFor(order) {
  if (!order.download) return null;
  return crypto.createHmac('sha256', SECRET).update(`${order.id}.${order.download.nonce}`).digest('base64url');
}

/** Generates a new download link for a paid order (old link stops working). */
function issueToken(order) {
  order.download = {
    nonce: crypto.randomBytes(16).toString('hex'),
    expiresAt: new Date(Date.now() + config.download.ttlHours * 3600e3).toISOString(),
    count: 0,
  };
  const token = tokenFor(order);
  order.download.tokenHash = sha256(token);
  persist();
  return token;
}

function findByToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const h = sha256(token);
  for (const o of orders.values()) {
    if (o.download && o.download.tokenHash === h) return o;
  }
  return null;
}

function findPaidByEmail(email) {
  const list = [...orders.values()].filter((o) => o.status === 'paid' && o.email === email);
  return list.sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1))[0] || null;
}

load();
SECRET = loadSecret();

module.exports = { createOrder, getOrder, updateOrder, markPaid, issueToken, tokenFor, findByToken, findPaidByEmail, persist };
