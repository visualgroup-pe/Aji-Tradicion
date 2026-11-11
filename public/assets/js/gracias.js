(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var orderId = params.get('pedido') || params.get('external_reference');
  try { if (!orderId) orderId = localStorage.getItem('aji_last_order'); } catch (e) { /* noop */ }
  var paymentId = params.get('payment_id') || params.get('collection_id');
  var mpStatus = params.get('status') || params.get('collection_status');

  var states = document.querySelectorAll('[data-state]');
  function show(name) { states.forEach(function (s) { s.hidden = s.getAttribute('data-state') !== name; }); }

  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) { show('missing'); return; }

  var tries = 0;
  var timer = null;

  function fmt(iso) {
    try { return new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }

  function check() {
    tries += 1;
    var url = '/api/pedidos/' + encodeURIComponent(orderId) + (paymentId ? '?payment_id=' + encodeURIComponent(paymentId) : '');
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (r.status === 404) throw new Error('404'); return r.json(); })
      .then(function (d) {
        if (d.status === 'paid' && d.download) {
          show('paid');
          var a = document.querySelector('[data-download]');
          a.href = d.download.url;
          var meta = 'Pedido ' + d.id + ' · Enlace válido hasta el ' + fmt(d.download.expiresAt) + ' · Descargas disponibles: ' + d.download.remaining + '.';
          if (d.emailSent) meta += ' También te enviamos el enlace por correo.';
          document.querySelector('[data-download-meta]').textContent = meta;
          try { localStorage.removeItem('aji_last_order'); } catch (e) { /* noop */ }
          try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'purchase', value: d.amount, currency: d.currency, transaction_id: d.id }); } catch (e) { /* noop */ }
          return;
        }
        var last = d.lastPaymentStatus || mpStatus;
        if (last === 'rejected' || last === 'cancelled' || mpStatus === 'null' || mpStatus === 'failure') { show('failed'); return; }
        // Seguir consultando unos minutos (webhook / acreditación).
        if (tries < 40) {
          if (tries > 6) show('pending');
          timer = setTimeout(check, tries < 10 ? 2500 : 6000);
        } else {
          show('pending');
        }
      })
      .catch(function (err) {
        if (err.message === '404') { show('missing'); return; }
        if (tries < 40) timer = setTimeout(check, 5000); else show('pending');
      });
  }

  var retry = document.querySelector('[data-retry-check]');
  if (retry) retry.addEventListener('click', function () { clearTimeout(timer); tries = 0; show('checking'); check(); });

  check();
})();
