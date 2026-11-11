(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // "preview" = versión estática (GitHub Pages): sin servidor, no hay pagos.
  var modeMeta = document.querySelector('meta[name="aji-mode"]');
  var PREVIEW = Boolean(modeMeta && modeMeta.content === 'preview');
  var PREVIEW_MSG = 'Vista previa: el pago con Mercado Pago se activa cuando la página corre en su servidor. Aquí no se realiza ningún cobro.';

  // ---------- Header con borde al hacer scroll + barra fija móvil ----------
  var header = document.querySelector('[data-header]');
  var sticky = document.querySelector('[data-sticky]');
  var hero = document.querySelector('.hero');
  var finalCta = document.querySelector('.final-cta');

  function onScroll() {
    var y = window.scrollY || 0;
    if (header) header.classList.toggle('is-scrolled', y > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (sticky && 'IntersectionObserver' in window && hero) {
    var heroVisible = true;
    var finalVisible = false;
    var update = function () {
      var show = !heroVisible && !finalVisible;
      sticky.classList.toggle('is-visible', show);
      sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
      var b = sticky.querySelector('button');
      if (b) b.tabIndex = show ? 0 : -1;
    };
    new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; update(); }, { threshold: 0.05 }).observe(hero);
    if (finalCta) new IntersectionObserver(function (e) { finalVisible = e[0].isIntersecting; update(); }, { threshold: 0.2 }).observe(finalCta);
  }

  // ---------- Aparición suave al hacer scroll ----------
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el, i) {
      el.style.transitionDelay = (i % 3) * 70 + 'ms';
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  // ---------- Checkout ----------
  var dialog = document.querySelector('[data-checkout]');
  var form = document.querySelector('[data-checkout-form]');
  var lastTrigger = null;

  function track(event, data) {
    // Punto único para conectar analítica (Meta Pixel, GA4, etc.).
    try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: event }, data || {})); } catch (e) { /* noop */ }
  }

  function openCheckout(trigger) {
    lastTrigger = trigger || null;
    track('begin_checkout');
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
      var email = form.querySelector('input[name="email"]');
      setTimeout(function () { email && email.focus(); }, 60);
    } else if (form) {
      // Navegadores sin <dialog>: mostrar como bloque normal.
      dialog.setAttribute('open', '');
      dialog.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  document.querySelectorAll('[data-buy]').forEach(function (btn) {
    btn.addEventListener('click', function () { openCheckout(btn); });
  });

  if (dialog) {
    dialog.querySelector('[data-close]').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () { if (lastTrigger) lastTrigger.focus(); });
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      var submit = form.querySelector('button[type="submit"]');
      var label = submit.querySelector('[data-label]');
      var email = form.email.value.trim();
      msg.textContent = '';
      if (!EMAIL_RE.test(email)) { msg.textContent = 'Revisa tu correo: lo necesitamos para enviarte el recetario.'; form.email.focus(); return; }
      if (!form.terms.checked) { msg.textContent = 'Para continuar, acepta los términos y la política de privacidad.'; form.terms.focus(); return; }

      if (PREVIEW) { msg.textContent = PREVIEW_MSG; return; }

      submit.setAttribute('aria-busy', 'true');
      var original = label.textContent;
      label.textContent = 'Preparando tu pago…';

      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, name: form.name.value.trim() })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok || !res.d.redirectUrl) throw new Error(res.d.error || 'No pudimos iniciar el pago.');
          try { localStorage.setItem('aji_last_order', res.d.orderId); } catch (err) { /* noop */ }
          track('add_payment_info');
          window.location.assign(res.d.redirectUrl);
        })
        .catch(function (err) {
          msg.textContent = err.message || 'No pudimos iniciar el pago. Inténtalo de nuevo.';
          submit.removeAttribute('aria-busy');
          label.textContent = original;
        });
    });
  }

  // ---------- Recuperar descarga ----------
  var resend = document.querySelector('[data-resend]');
  if (resend) {
    resend.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = resend.querySelector('.form-msg');
      var email = resend.email.value.trim();
      if (!EMAIL_RE.test(email)) { out.textContent = 'Ingresa un correo válido.'; return; }
      if (PREVIEW) { out.textContent = PREVIEW_MSG; return; }
      var btn = resend.querySelector('button');
      btn.setAttribute('aria-busy', 'true');
      fetch('/api/reenviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { out.textContent = d.message || d.error || ''; })
        .catch(function () { out.textContent = 'No pudimos procesar tu solicitud. Inténtalo más tarde.'; })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });
  }
})();
