const { chromium } = require('playwright');
const path = require('path');
const plan = {
  'f-iloader': ['i-acct', 'i-dev', 'i-btn'],
  'f-vpn': ['v-btn'],
  'f-trust': ['t-btn'],
  'f-devmode': ['d-row'],
  'f-myapps': ['m-days'],
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'mock.html'));
  await p.evaluate((plan) => {
    for (const [frame, ids] of Object.entries(plan)) {
      const f = document.getElementById(frame);
      const fr = f.getBoundingClientRect();
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        el.classList.add('hl');
        const r = el.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = ids.length > 1 ? String(i + 1) : '✓';
        badge.style.left = (r.left - fr.left - 76) + 'px';
        badge.style.top = (r.top - fr.top + r.height / 2 - 29) + 'px';
        f.appendChild(badge);
      });
    }
  }, plan);
  for (const id of Object.keys(plan)) await (await p.$('#' + id)).screenshot({ path: path.join(process.env.OUT, id.slice(2) + '.png') });
  await b.close();
})();
