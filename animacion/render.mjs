// Uso: node render.mjs <outDir> <w> <h> <fps> <from> <to> [quality]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const [outDir, w, h, fps, from, to, q = '93'] = process.argv.slice(2);
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); } }); }).listen(0);
const port = srv.address().port;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text())); page.on('pageerror', e => console.log('[err]', e.message));
await page.goto(`http://localhost:${port}/index.html?w=${w}&h=${h}`);
await page.waitForFunction('window.ready === true', null, { timeout: 120000 });
for (let f = +from; f <= +to; f++) {
  const t0 = Date.now(); const t = Math.min(20, f / +fps);
  await page.evaluate(t => window.renderFrame(t), t);
  await page.screenshot({ path: path.join(outDir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: +q });
  console.log('frame', f, 't=', t.toFixed(2), Date.now() - t0, 'ms');
}
await browser.close(); srv.close();
