// Genera favicons PNG, apple-touch-icon e imagen Open Graph a partir de los SVG de marca.
// Uso: node scripts/build-social.js   (requiere Playwright con Chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'public/assets/brand');
const IMG = path.join(ROOT, 'public/assets/img');
const FONTS = path.join(ROOT, 'public/assets/fonts');
const url = (p) => 'file://' + p;
const TMP = path.join(__dirname, '.tmp-social.html');
async function render(page, html) { fs.writeFileSync(TMP, html); await page.goto(url(TMP)); await page.waitForLoadState('networkidle'); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const [file, size, bg] of [['favicon-32.png', 32, 'transparent'], ['apple-touch-icon.png', 180, '#B23A1E'], ['icon-192.png', 192, 'transparent'], ['icon-512.png', 512, 'transparent']]) {
    await page.setViewportSize({ width: size, height: size });
    const src = file === 'apple-touch-icon.png' ? 'avatar-redes.svg' : 'favicon.svg';
    await render(page, `<html><body style="margin:0;background:${bg}"><img src="${url(path.join(BRAND, src))}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(BRAND, file), omitBackground: bg === 'transparent' });
  }

  await page.setViewportSize({ width: 1200, height: 630 });
  await render(page, `<html><head><style>
    @font-face{font-family:F;src:url(${url(path.join(FONTS, 'fraunces-latin-opsz-normal.woff2'))})}
    @font-face{font-family:F;font-style:italic;src:url(${url(path.join(FONTS, 'fraunces-latin-opsz-italic.woff2'))})}
    @font-face{font-family:M;src:url(${url(path.join(FONTS, 'manrope-latin-wght-normal.woff2'))})}
    body{margin:0;width:1200px;height:630px;display:grid;grid-template-columns:560px 640px;background:#FAF4EA;font-family:M}
    .t{padding:56px 48px 48px 64px;display:flex;flex-direction:column;justify-content:space-between}
    h1{font:560 76px/0.98 F;color:#2A1C14;margin:0;letter-spacing:-1.5px}
    h1 em{font-weight:440;color:#B23A1E}
    p{font-size:24px;color:#6E5B4B;margin:18px 0 0}
    .chips{display:flex;gap:10px;flex-wrap:wrap}
    .chips span{font-weight:700;font-size:17px;color:#2A1C14;border:1.5px solid rgba(42,28,20,.18);border-radius:99px;padding:8px 16px}
    .ph{background:url(${url(path.join(IMG, 'hero-ceviche-1280.webp'))}) center/cover;border-radius:0}
  </style></head><body>
  <div class="t"><img src="${url(path.join(BRAND, 'logo-horizontal.svg'))}" style="height:58px;width:auto;align-self:flex-start">
  <div><h1>100 recetas <em>peruanas</em> completas</h1><p>Del ceviche al ají de gallina, para cocinar en casa.</p></div>
  <div class="chips"><span>PDF</span><span>4 porciones</span><span>Paso a paso</span><span>Tips</span></div></div>
  <div class="ph"></div></body></html>`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(BRAND, 'og-image.jpg'), type: 'jpeg', quality: 86 });
  await browser.close();
  fs.unlinkSync(TMP);
  console.log('ok');
})();
