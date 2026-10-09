/* احجزلي · أدوات اللوحات المشتركة: الاتصال، الدخول بالرابط الخاص، التواريخ، الأيقونات، التنبيه بصوت الفلوس */
(function () {
  const URL_ = 'https://kvreqxdgjeietzsfamei.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cmVxeGRnamVpZXR6c2ZhbWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1Njg3MDYsImV4cCI6MjEwNzE0NDcwNn0.WrZKDYnTuu4zxwMLHIfLoeWkSTSpI-7XsXpfvORNrzs';
  const FN = URL_ + '/functions/v1';
  const TZ = 'Asia/Riyadh';
  let sb = null, storageKey = '';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function client(key) {
    storageKey = key;
    sb = window.supabase.createClient(URL_, ANON, { auth: { storageKey: key, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    return sb;
  }

  // الدخول بالرابط الخاص (#k=...)؛ الرابط يتحفظ في الجهاز فيكفي يفتحه مرة وحدة
  async function enter(key, force) {
    if (!sb || storageKey !== key) client(key);
    const m = location.hash.match(/k=([A-Za-z0-9_-]{20,})/);
    let tok = m ? m[1] : null;
    if (m) {
      try { localStorage.setItem(key + ':link', tok); } catch (e) { /* */ }
      history.replaceState(null, '', location.pathname + location.search);
    } else { try { tok = localStorage.getItem(key + ':link'); } catch (e) { /* */ } }
    if (!m && !force) {
      const { data } = await sb.auth.getSession();
      if (data && data.session) return data.session;
    }
    if (!tok) return null;
    const r = await fetch(FN + '/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tok }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      if (r.status === 401) { try { localStorage.removeItem(key + ':link'); } catch (e) { /* */ } }
      const err = new Error(j.error || 'link'); err.code = j.error || 'link'; throw err;
    }
    const { data, error } = await sb.auth.verifyOtp({ token_hash: j.token_hash, type: 'magiclink' });
    if (error) throw error;
    return data.session;
  }

  // من أنا: مدير؟ وعضو في أي منشأة؟ (قراءة مباشرة بصلاحيات الجلسة)
  async function me() {
    const { data } = await sb.auth.getSession();
    const uid = data && data.session && data.session.user && data.session.user.id;
    if (!uid) { const e = new Error('unauthorized'); e.code = 'unauthorized'; throw e; }
    const [a, m] = await Promise.all([
      sb.from('platform_admins').select('user_id').eq('user_id', uid).maybeSingle(),
      sb.from('members').select('business_id, role, staff_id, business:businesses(id,name,slug,logo_url,brand_color,plan,status,is_demo)').eq('user_id', uid),
    ]);
    if (a.error || m.error) { const e = new Error('unauthorized'); e.code = 'unauthorized'; throw e; }
    return { admin: !!a.data, members: m.data || [] };
  }

  // دخول كامل: الجلسة المحفوظة، ولو ما عادت صالحة نجدّدها من الرابط المحفوظ في الجهاز
  async function boot(key) {
    let session = await enter(key);
    if (!session) return { session: null, me: null };
    try { return { session, me: await me() }; }
    catch (e) {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (x) { /* */ }
      let tok = null; try { tok = localStorage.getItem(key + ':link'); } catch (x) { /* */ }
      if (!tok) throw e;
      session = await enter(key, true);
      return { session, me: await me() };
    }
  }

  async function signOut() { try { localStorage.removeItem(storageKey + ':link'); } catch (e) { /* */ } await sb.auth.signOut().catch(() => {}); }

  async function api(path, body) {
    const { data } = await sb.auth.getSession();
    const tok = data && data.session ? data.session.access_token : ANON;
    let r;
    try { r = await fetch(FN + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, apikey: ANON }, body: JSON.stringify(body || {}) }); }
    catch (e) { const err = new Error('network'); err.code = 'network'; throw err; }
    const j = await r.json().catch(() => ({ ok: false, error: 'network' }));
    if (!j.ok) { const err = new Error(j.error || 'error'); err.code = j.error; err.status = r.status; err.detail = j.detail; throw err; }
    return j;
  }

  // ───── التواريخ بتوقيت الرياض ─────
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function parts(t) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
    const y = +p.year, m = +p.month, d = +p.day;
    return { y, m, d, hh: +p.hour % 24, mm: +p.minute, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), ymd: `${p.year}-${p.month}-${p.day}` };
  }
  const today = () => parts(Date.now()).ymd;
  function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function dayName(ymd) { const [y, m, d] = ymd.split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`; }
  function relDay(ymd) { const t = today(); if (ymd === t) return 'اليوم'; if (ymd === addDays(t, 1)) return 'بكرة'; if (ymd === addDays(t, -1)) return 'أمس'; return dayName(ymd); }
  function time(t) { const p = parts(t); const h = p.hh % 12 === 0 ? 12 : p.hh % 12; return `${h}:${String(p.mm).padStart(2, '0')} ${p.hh < 12 ? 'ص' : 'م'}`; }
  const day = (t) => dayName(parts(t).ymd);
  const when = (t) => `${relDay(parts(t).ymd)} · ${time(t)}`;
  function ago(t) {
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return 'الحين'; if (s < 3600) return `قبل ${Math.floor(s / 60)} د`; if (s < 86400) return `قبل ${Math.floor(s / 3600)} س`;
    const d = Math.floor(s / 86400); return d === 1 ? 'أمس' : `قبل ${d} أيام`;
  }
  function money(n) { const v = Number(n || 0); return v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); }
  const phone = (wa) => { const s = String(wa || ''); return s.startsWith('966') ? '0' + s.slice(3) : s; };
  const waLink = (wa) => `https://wa.me/${String(wa || '').replace(/\D/g, '')}`;

  const STATUS = { confirmed: 'مؤكد', on_the_way: 'في الطريق', arrived: 'وصل الموظف', invoiced: 'بانتظار الدفع', done: 'مكتمل', cancelled: 'ملغي' };
  const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS[s] || s)}</span>`;

  // ───── أيقونات (خطوط بسيطة) ─────
  const P = {
    orders: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.1A8.5 8.5 0 1 1 21 12z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4a6.5 6.5 0 0 1 3.5 5.6"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
    store: '<path d="M3 9h18l-1.5-5h-15L3 9z"/><path d="M4 9v11h16V9M9 20v-6h6v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    belloff: '<path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M2 2l20 20"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    car: '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01M9 18h6"/>',
    guide: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M20 17v4H6.5a2.5 2.5 0 0 1 0-5"/>',
    sale: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
    wa: '<path d="M3 21l1.7-5.2A8.8 8.8 0 1 1 8 19.4L3 21z"/><path d="M9 9.5c.3 1.6 1.6 3.4 3.3 4.4l1.2-1 1.8.8c-.2 1-.9 1.7-2 1.7C10.8 15.4 8 12.8 7.7 10c0-1 .6-1.8 1.6-2.1l.9 1.7-1.2 1z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    play: '<path d="M6 4l14 8-14 8V4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  };
  const icon = (n) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  // ───── رسائل ونوافذ ─────
  let toastT = null;
  function toast(msg, bad) {
    let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = bad ? 'bad' : ''; }, bad ? 4200 : 2600);
  }
  const ERR = {
    network: 'تعذّر الاتصال، تأكد من الإنترنت', forbidden: 'ما عندك صلاحية لهذا', unauthorized: 'انتهت الجلسة، افتح الرابط مرة ثانية', bad_status: 'حالة الطلب تغيّرت، حدّث الصفحة',
    slot_taken: 'الوقت هذا محجوز', window_closed: 'ما تقدر ترسل رسالة حرة لأن العميل ما راسلكم خلال آخر 24 ساعة', send_failed: 'ما انرسلت الرسالة', items: 'تأكد من بنود الفاتورة',
    no_invoice: 'ما فيه فاتورة لهذا الطلب', image: 'الصورة لازم PNG أو JPG', too_big: 'الصورة كبيرة، اختر صورة أصغر', sk: 'المفتاح السري لازم يبدأ بـ sk_live_ أو sk_test_',
    pk: 'المفتاح العام لازم يبدأ بـ pk_live_ أو pk_test_', sk_rejected: 'ميسر رفض المفتاح، تأكد منه', plan: 'الدفع متاح في باقة أتمتة الحجز والدفع', not_connected: 'الرقم غير مربوط', no_waba: 'أدخل معرّف حساب واتساب للأعمال',
    phone_id_used: 'معرّف الرقم مستخدم لمنشأة ثانية', invalid_link: 'الرابط غير صالح أو انلغى', busy: 'محاولات كثيرة، جرّب بعد شوي', name: 'اكتب اسم المنشأة', not_demo: 'متاح للمنشآت التجريبية فقط',
  };
  const errText = (e) => ERR[e && e.code] || ERR[e && e.message] || (e && e.message) || 'صار خطأ';
  function fail(e) { console.error(e); toast(errText(e), true); }

  function copy(text, label) {
    const done = () => toast(label || 'انتسخ ✓');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('ما قدرت أنسخ', true); } ta.remove(); }
  }

  function overlay() { let o = $('ov'); if (!o) { o = document.createElement('div'); o.id = 'ov'; o.className = 'ov'; document.body.appendChild(o); o.addEventListener('click', closeAll); } return o; }
  function openDrawer(html) {
    let d = $('drawer'); if (!d) { d = document.createElement('aside'); d.id = 'drawer'; d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); document.body.appendChild(d); }
    d.innerHTML = html; overlay().classList.add('on'); requestAnimationFrame(() => d.classList.add('on'));
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
    return d;
  }
  function modal(html) {
    let m = $('modal'); if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); document.body.appendChild(m); }
    m.innerHTML = `<div class="box">${html}</div>`; overlay().classList.add('on'); requestAnimationFrame(() => m.classList.add('on'));
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
    const f = m.querySelector('input,select,textarea'); if (f) setTimeout(() => f.focus(), 60);
    return m;
  }
  function closeAll() { ['drawer', 'modal'].forEach((id) => { const x = $(id); if (x) x.classList.remove('on'); }); const o = $('ov'); if (o) o.classList.remove('on'); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // ───── تنبيه الطلب الجديد: صوت «فلوس» + تنبيه متصفح + وميض العنوان ─────
  let ac = null, alertsOn = true, titleT = null, baseTitle = document.title;
  try { alertsOn = localStorage.getItem('ihj_alerts') !== '0'; } catch (e) { /* */ }
  function unlock() { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { /* */ } }
  function cash() {
    if (!alertsOn) return;
    window.__ihjCash = (window.__ihjCash || 0) + 1;
    try {
      unlock(); if (!ac) return; const t = ac.currentTime, dest = ac.destination;
      const tone = (f, at, len, vol, type) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + len); o.connect(g).connect(dest); o.start(at); o.stop(at + len + 0.02); };
      const n = ac.createBufferSource(), buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.07), ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      n.buffer = buf; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2; const ng = ac.createGain(); ng.gain.value = 0.35; n.connect(bp).connect(ng).connect(dest); n.start(t); n.stop(t + 0.08);
      tone(2093, t + 0.06, 0.9, 0.22); tone(2637, t + 0.06, 0.8, 0.14); tone(1318, t + 0.06, 0.5, 0.08, 'triangle');
      [0.30, 0.37, 0.45, 0.52, 0.62].forEach((at, i) => tone(4200 + i * 350, t + at, 0.14, 0.10));
    } catch (e) { /* */ }
  }
  function flash(m) { clearInterval(titleT); let k = 0; titleT = setInterval(() => { document.title = (k++ % 2) ? baseTitle : '🔔 ' + m; }, 900); }
  function stopFlash() { if (titleT) { clearInterval(titleT); titleT = null; document.title = baseTitle; } }
  window.addEventListener('focus', stopFlash);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stopFlash(); });
  document.addEventListener('pointerdown', function f() { unlock(); document.removeEventListener('pointerdown', f); });
  function alertNew(title, body) {
    cash(); flash(title); toast('🔔 ' + title + (body ? ' · ' + body : ''));
    try { if (alertsOn && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') { const n = new Notification(title, { body, lang: 'ar', dir: 'rtl' }); n.onclick = () => { window.focus(); n.close(); }; } } catch (e) { /* */ }
  }
  function toggleAlerts() {
    unlock();
    const perm = ('Notification' in window) ? Notification.permission : 'x';
    alertsOn = !alertsOn;
    try { localStorage.setItem('ihj_alerts', alertsOn ? '1' : '0'); } catch (e) { /* */ }
    if (alertsOn) { cash(); if (perm === 'default') Notification.requestPermission().catch(() => {}); }
    toast(alertsOn ? '🔔 التنبيه بالصوت شغّال' : '🔕 التنبيه بالصوت موقف');
    return alertsOn;
  }
  const alertsState = () => alertsOn;
  function setTitle(t) { baseTitle = t; if (!titleT) document.title = t; }

  function mount(html) { const r = document.getElementById('root'); if (r) r.innerHTML = html; else document.body.innerHTML = html; }
  function gate(title, msg, kind) {
    mount( `<div class="gate"><div class="card"><div class="lg">${icon(kind === 'err' ? 'link' : 'check')}</div><h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p></div></div>`);
  }
  function loading(msg) {
    mount(`<div class="gate"><div class="card"><div class="spin"></div><p class="muted">${esc(msg || 'لحظة…')}</p></div></div>`);
  }

  // ───── أدوات صغيرة ─────
  function initials(name) { const w = String(name || '').trim().split(/\s+/); return (w[0] || '?').slice(0, 1) + (w[1] ? w[1].slice(0, 1) : ''); }
  function logoHtml(b, cls) { return b && b.logo_url ? `<span class="${cls || 'lg'}"><img src="${esc(b.logo_url)}" alt=""></span>` : `<span class="${cls || 'lg'}">${esc(initials(b && b.name))}</span>`; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function csv(rows) { return '﻿' + rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'); }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const theme = () => { try { const t = localStorage.getItem('ihj_theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* */ } };
  theme();

  window.IHJ = {
    URL: URL_, ANON, FN, TZ, get sb() { return sb; }, client, enter, boot, signOut, api, me,
    $, esc, parts, today, addDays, dayName, relDay, time, day, when, ago, money, phone, waLink, STATUS, badge,
    icon, toast, fail, errText, copy, openDrawer, modal, closeAll, cash, alertNew, toggleAlerts, alertsState, unlock, setTitle, stopFlash,
    gate, loading, initials, logoHtml, debounce, csv, download,
  };
})();
