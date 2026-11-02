// Проверка игры Peers Journey 21 в headless Chrome без зависимостей (CDP через встроенный WebSocket Node 22):
//   python3 -m http.server 5321 &  node tools/game-test.mjs /tmp/pj21
import fs from 'node:fs';
import { spawn } from 'node:child_process';

async function launch(W, H, mobile) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(process.env.CHROME || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--proxy-server=' + (process.env.HTTPS_PROXY || ''), '--proxy-bypass-list=localhost;127.0.0.1', `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, '--user-data-dir=/tmp/pj21-chrome-' + port, 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const tgt = ver.find((t) => t.type === 'page');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map(); const handlers = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } else handlers.forEach((h) => h(m)); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: !!mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const page = {
    on(_t, fn) { handlers.push((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) fn({ kind: 'console', text: `[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' ') });
      if (m.method === 'Runtime.exceptionThrown') fn({ kind: 'err', text: '[pageerror] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text) });
    }); },
    async goto(url) { await send('Page.navigate', { url }); },
    async evaluate(fn, ...args) {
      const expr = typeof fn === 'string' ? fn : `(${fn})(...${JSON.stringify(args)})`;
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitForFunction(fn, { timeout = 60000 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { try { if (await page.evaluate(fn)) return; } catch { /* ещё грузится */ } await new Promise((r) => setTimeout(r, 300)); }
      console.log('LOGS:', (globalThis.__logs || []).join('\n')); console.log('STATE:', await page.evaluate('JSON.stringify({walk: window.__s21?.walk?.state?.(), people: window.__s21?.peopleApi?.()?.count, ov: document.getElementById("w-ov-title")?.textContent})').catch(e=>e.message)); throw new Error('timeout: ' + fn.toString().slice(0, 80));
    },
    async screenshot({ path }) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); fs.writeFileSync(path, Buffer.from(r.data, 'base64')); },
    keyboard: { async press(code) {
      const map = { KeyE: ['e', 69], Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13] };
      const [key, vk] = map[code] || (/^Digit(\d)$/.test(code) ? [code.slice(5), 48 + +code.slice(5)] : [code, 0]);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
    } },
    async click(sel) {
      const c = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: c[0], y: c[1], button: 'left', clickCount: 1 });
    },
  };
  const browser = { close() { try { ws.close(); } catch {} proc.kill('SIGKILL'); } };
  return { browser, page };
}

const out = process.argv[2] || '/tmp/pj21';
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 1440), H = +(process.env.H || 900);
const { browser, page } = await launch(W, H, !!process.env.MOBILE);
const logs = []; globalThis.__logs = logs;
page.on('log', (m) => logs.push(m.text));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.jpg` }); console.log('shot', name); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);

await page.goto(`${process.env.URL || 'http://localhost:5321'}/?q=low`);
await page.waitForFunction(() => window.__s21 && !document.getElementById('loader'), { timeout: 300000 });
await page.waitForFunction(() => window.__s21.peopleApi()?.count > 0, { timeout: 120000 }).catch(() => logs.push('люди не загрузились'));
await page.waitForFunction(() => !document.getElementById('w-go').disabled, { timeout: 120000 });
await shot('01-title');
await page.click('#w-go');
await sleep(1500);
await shot('02-start');

const G = () => window.__s21.game.debug;
// проходимость станций и мест
const report = await ev(() => {
  const W = window.__s21.walk, G = window.__s21.game.debug;
  const r = {};
  for (const st of Object.values(G.stations)) { const s = W.teleport(st.u + 1.2, st.v + 0.2, st.level === 'B1' ? st.z : st.level, { force: false }); r['st:' + st.id] = s ? `${s.level}/${s.zone}` : 'НЕТ МЕСТА'; }
  return r;
});
const places = await ev(async () => {
  const D = await import(location.origin + '/src/game/data.js');
  const W = window.__s21.walk, r = {};
  for (const [id, p] of Object.entries(D.PLACES)) { const s = W.teleport(p.u, p.v, p.z, { force: false, radius: 1.5 }); r[id] = s ? `${s.level}/${s.zone} d=${Math.hypot(s.u - p.u, s.v - p.v).toFixed(1)}` : 'НЕТ МЕСТА'; }
  return r;
});
console.log(JSON.stringify(report, null, 1)); console.log(JSON.stringify(places, null, 1));

// 1) регистрация у ADM
await ev(() => window.__s21.walk.teleport(45.4, 21.4, 'L1', { yaw: 0 }));
await sleep(900);
console.log('near ADM:', await ev(() => { const n = window.__s21.game.debug.near(); return n && (n.kind + ':' + (n.st?.id || '')); }));
await shot('03-adm-prompt');
await page.keyboard.press('KeyE'); await sleep(400);
await shot('04-adm-dialog');
await page.click('.g-opt[data-i="0"]'); await sleep(500);
await shot('05-registered');
await page.keyboard.press('Digit1'); await sleep(300);
console.log('state:', JSON.stringify(await ev(() => { const s = window.__s21.game.debug.state(); return { stage: s.stage, prp: s.prp }; })));

// 2) пир-ревью
await sleep(600);
const gv = await ev(() => window.__s21.game.debug.givers().map((g) => ({ kind: g.kind, name: g.name, lvl: g.p.level, x: g.p.root.position.x, z: g.p.root.position.z })));
console.log('givers:', JSON.stringify(gv));
const rv = gv.find((g) => g.kind === 'review');
if (rv) {
  await ev((g) => { const u = g.x + 27.6, v = 27.6 - g.z; const W = window.__s21.walk; W.teleport(u, v, g.lvl, { radius: 2 }); W.lookAt(u, v); }, rv);
  await sleep(900);
  console.log('near giver:', await ev(() => window.__s21.game.debug.near()?.kind));
  await page.keyboard.press('KeyE'); await sleep(400);
  await shot('06-review');
  await page.keyboard.press('Digit2'); await sleep(400);
  await shot('07-review-result');
  await page.keyboard.press('Digit1'); await sleep(300);
}

// 3) проект за iMac
await ev(() => window.__s21.walk.teleport(12.0, 45.0, 'L2', { yaw: 0 }));
await sleep(900);
await shot('08-cluster');
await page.keyboard.press('KeyE'); await sleep(400);
await shot('09-desk');
await page.keyboard.press('Digit1'); await sleep(400);
await shot('10-quiz');
for (let i = 0; i < 3; i++) { await page.keyboard.press('Digit1'); await sleep(250); }
await shot('11-project-result');
await page.keyboard.press('Digit1'); await sleep(300);

// 4) мерч
await ev(() => window.__s21.game.debug.set({ coins: 200 }));
await ev(() => { const W = window.__s21.walk; W.teleport(51.0, 21.6, 'L1'); W.lookAt(52.7, 22.2); });
await sleep(900);
await shot('12-merch-prompt');
await page.keyboard.press('KeyE'); await sleep(400);
await shot('13-shop');
await page.keyboard.press('Digit3'); await sleep(400);
await page.keyboard.press('Escape'); await sleep(300);

// 5) ивент
await ev(() => window.__s21.game.debug.set({ stage: 'core', xp: 500, examPassed: true, task: { type: 'event', id: 'fun', step: 2 } }));
await ev(() => window.__s21.walk.teleport(22.0, 11.0, 'L1', { yaw: 180 }));
await sleep(2500);
console.log('crowd:', await ev(() => window.__s21.peopleApi().mode));
await shot('14-event');

// 6) профиль
await page.keyboard.press('Tab'); await sleep(400);
await shot('15-profile');
await page.keyboard.press('Escape'); await sleep(300);

// 7) экзаменатор и Career Hub в кадре
await ev(() => { const W = window.__s21.walk; W.teleport(17.6, 25.0, -4.05); W.lookAt(17.6, 22.6); });
await sleep(900); await shot('16-exam');
await ev(() => { const W = window.__s21.walk; W.teleport(40.0, 45.6, 'L2'); W.lookAt(42.6, 45.6); });
await sleep(900); await shot('17-career');

console.log('LOGS:\n' + logs.slice(0, 40).join('\n'));
await browser.close();
