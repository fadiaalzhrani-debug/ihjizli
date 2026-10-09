// متصفح Edge مخفي عبر CDP للقطات الشاشة والفحص الآلي (بدون مكتبات خارجية)
// const b = await launch({ width: 390, height: 844, scale: 2, mobile: true, dark: false });
// await b.go(url); await b.ev('document.title'); await b.shot('out.png'); await b.close();
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTag(tag) {
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore', timeout: 20000 });
  } catch { /* */ }
}

// تنظيف بقايا تشغيلات قديمة (أقدم من ساعة)
function sweep() {
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (!d.startsWith('ihjcdp_')) continue;
      const p = path.join(os.tmpdir(), d);
      const age = Date.now() - fs.statSync(p).mtimeMs;
      if (age > 3600_000) { killTag(d); fs.rmSync(p, { recursive: true, force: true }); }
    }
  } catch { /* */ }
}

export async function launch(o = {}) {
  sweep();
  const tag = `ihjcdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prof = path.join(os.tmpdir(), tag);
  fs.mkdirSync(prof, { recursive: true });
  const args = ['--headless=new', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--lang=ar', '--window-size=1400,1000',
    ...(o.gpu ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu']), 'about:blank'];
  const proc = spawn(EDGE, args, { stdio: 'ignore', detached: false, windowsHide: true });
  proc.on('error', () => {});
  const portFile = path.join(prof, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { killTag(tag); throw new Error('edge did not start'); }
  let port = '';
  for (let i = 0; i < 20 && !port; i++) { port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]; if (!port) await sleep(100); }
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = list.find((t) => t.type === 'page'); } catch { /* */ }
    if (!target) await sleep(100);
  }
  if (!target) { killTag(tag); throw new Error('no page target'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  const consoleLog = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled') consoleLog.push({ type: m.params.type, text: (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
    if (m.method === 'Runtime.exceptionThrown') consoleLog.push({ type: 'exception', text: m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '' });
    for (const l of listeners.slice()) l(m);
  };
  const cmd = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const waitEvent = (name, ms = 15000) => new Promise((res) => {
    const t = setTimeout(() => { const k = listeners.indexOf(f); if (k >= 0) listeners.splice(k, 1); res(null); }, ms);
    const f = (m) => { if (m.method === name) { clearTimeout(t); const k = listeners.indexOf(f); if (k >= 0) listeners.splice(k, 1); res(m.params); } };
    listeners.push(f);
  });
  await cmd('Page.enable'); await cmd('Runtime.enable');
  const width = o.width || 1280, height = o.height || 800;
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: o.scale || 1, mobile: !!o.mobile });
  if (o.mobile) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: o.dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: o.reducedMotion ? 'reduce' : 'no-preference' }] });
  if (o.storage) {
    // تجهيز localStorage قبل تحميل الصفحة
    await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try{const s=${JSON.stringify(o.storage)};for(const k in s)localStorage.setItem(k,s[k]);}catch(e){}` });
  }
  const b = {
    tag, cmd, log: consoleLog,
    async go(url, wait = 1200) {
      const loaded = waitEvent('Page.loadEventFired', 20000);
      await cmd('Page.navigate', { url });
      await loaded;
      if (wait) await sleep(wait);
    },
    async ev(expr, awaitPromise = true) {
      const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result?.value;
    },
    async waitFor(expr, ms = 15000, step = 150) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { try { if (await b.ev(expr)) return true; } catch { /* */ } await sleep(step); }
      return false;
    },
    async shot(file, full = false) {
      let clip;
      if (full) {
        const m = await cmd('Page.getLayoutMetrics');
        const cs = m.cssContentSize || m.contentSize;
        clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(Math.min(cs.height, 12000)), scale: 1 };
      }
      const r = await cmd('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async close() {
      try { await cmd('Browser.close'); } catch { /* */ }
      try { ws.close(); } catch { /* */ }
      await sleep(300);
      killTag(tag);
      try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* */ }
    },
  };
  return b;
}
