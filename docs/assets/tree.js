// شجرة الردود: رسالة فوقها خيارات، وكل خيار يا إجراء (احجز، الأسعار، خدمة معيّنة…) يا رسالة جديدة فوقها خياراتها، لأي عمق.
// MenuTree.mount(el, { draft, lang, bizName, logo, services, faq, onSave }) · draft = { tree: [...], welcome: {ar, en}, def: {ar, en}, path: [] }
// العقدة: { id, t, t_en, go, text, text_en, opts } · go: msg أو إجراء (نفس اللي يفهمه الرد الآلي في _shared/bot.ts)
(function () {
  const I = window.IHJ, { esc, icon } = I;
  // [المفتاح، اسم النوع القصير، وش يسوي للعميل، اسم الزر عربي، إنجليزي، الأيقونة]
  const ACTS = [
    ['msg', 'رسالة جديدة', 'يفتح رسالة لها خياراتها', '', '', 'chat'],
    ['book', 'يبدأ الحجز', 'يختار الخدمة واليوم والوقت', 'احجز من هنا', 'Book now', 'cal'],
    ['svc', 'يحجز خدمة', 'يبدأ حجز خدمة وحدة على طول', '', '', 'cal'],
    ['prices', 'يرسل الأسعار', 'يرد بالأسعار من خدماتك', 'الأسعار', 'Prices', 'sale'],
    ['services', 'يرسل الخدمات', 'يرد بقائمة خدماتك', 'الخدمات', 'Services', 'box'],
    ['location', 'يرسل الموقع', 'يرد بموقعكم أو المدن اللي تغطونها', 'موقعنا', 'Location', 'pin'],
    ['hours', 'يرسل الدوام', 'يرد بأوقات الدوام', 'الدوام', 'Hours', 'clock'],
    ['pay', 'طريقة الدفع', 'يرد بطريقة الدفع', 'طريقة الدفع', 'Payment', 'money'],
    ['orders', 'طلباته', 'يعرض طلباته ويغيّر الموعد أو يلغي', 'طلباتي', 'My orders', 'orders'],
    ['packages', 'البكجات', 'يعرض البكجات ويقدر يشتري', 'البكجات', 'Packages', 'file'],
    ['balance', 'رصيده', 'يعرض رصيده من البكجات', 'رصيدي', 'My balance', 'money'],
    ['contact', 'يحوّله لكم', 'تجيك محادثته في لوحتك وترد بنفسك', 'تواصل معنا', 'Contact us', 'users'],
    ['lang', 'يغيّر اللغة', 'يحوّل الردود للغة الثانية', 'English', 'عربي', 'globe'],
    ['back', 'رجوع', 'يرجع للرسالة اللي قبل', 'رجوع', 'Back', 'back'],
    ['home', 'أول رسالة', 'يرجع لأول رسالة', 'القائمة', 'Menu', 'home'],
  ];
  const ACT = Object.fromEntries(ACTS.map((a) => [a[0], a]));
  const GROUPS = [['يفتح', ['msg']], ['يحجز', ['book', 'svc']], ['يرد بمعلومة', ['prices', 'services', 'location', 'hours', 'pay']], ['حساب العميل', ['orders', 'packages', 'balance']], ['تنقّل وتواصل', ['back', 'home', 'contact', 'lang']]];
  const MAXO = 10;
  const newId = () => (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '').padEnd(8, 'x');
  const kindOf = (o) => (o.go || '').startsWith('svc:') ? 'svc' : (o.go || 'msg');
  const nOpts = (c) => c === 1 ? 'خيار واحد' : c === 2 ? 'خياران' : c + ' خيارات';

  // أيقونات زيادة على أيقونات اللوحة
  const XI = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    chev: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    reply: '<path d="M9 14 4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    wand: '<path d="m15 4 5 5L9 20H4v-5z"/><path d="M13 6l5 5"/>',
  };
  const ic = (n) => XI[n] ? `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${XI[n]}</svg>` : icon(n);

  // من الأزرار القديمة (menu.main) لأول شجرة
  function fromMain(main, faq) {
    const keys = Array.isArray(main) && main.length ? main : ['book', 'orders', 'lang'];
    const out = [];
    for (const k of keys) {
      const f = /^faq:(\d+)$/.exec(k);
      if (f) { const e = (faq || [])[+f[1]]; if (e && e.a) out.push({ id: newId(), t: String(e.chip || e.q || 'سؤال').slice(0, 20), go: 'msg', text: e.a, opts: [] }); continue; }
      if (ACT[k]) out.push({ id: newId(), t: ACT[k][3], t_en: ACT[k][4], go: k });
    }
    return out;
  }

  // شجرة جاهزة من بيانات المنشأة نفسها: احجز، خدماتنا (كل خدمة رسالة بسعرها وزر يحجزها)، أسئلة، تواصل
  function starter(services, faq) {
    const svcs = (services || []).filter((s) => s.active !== false).slice(0, 9);
    const price = (s) => s.price == null ? 'السعر بعد المعاينة' : `${s.price_from ? 'يبدأ من ' : ''}${I.money(s.price)} ريال`;
    const tree = [{ id: newId(), t: 'احجز من هنا', t_en: 'Book now', go: 'book' }];
    if (svcs.length) tree.push({ id: newId(), t: 'خدماتنا', t_en: 'Our services', go: 'msg', text: 'اختر الخدمة وأعطيك تفاصيلها 👇', text_en: 'Pick a service to see the details 👇', opts: svcs.map((s) => ({ id: newId(), t: String(s.name).slice(0, 20), t_en: String(s.name_en || '').slice(0, 20), go: 'msg', text: `${s.name}\n${price(s)}`, opts: [{ id: newId(), t: 'احجز هالخدمة', t_en: 'Book this', go: 'svc:' + s.id }, { id: newId(), t: 'رجوع', t_en: 'Back', go: 'back' }] })) });
    const qs = (faq || []).filter((e) => e && e.a).slice(0, 8);
    if (qs.length) tree.push({ id: newId(), t: 'أسئلة شائعة', t_en: 'FAQ', go: 'msg', text: 'وش سؤالك؟', text_en: 'What would you like to know?', opts: [...qs.map((e) => ({ id: newId(), t: String(e.chip || String(e.q || '').split(/[,،]/)[0] || 'سؤال').slice(0, 20), go: 'msg', text: e.a, opts: [{ id: newId(), t: 'رجوع', t_en: 'Back', go: 'back' }] })), { id: newId(), t: 'رجوع', t_en: 'Back', go: 'back' }] });
    tree.push({ id: newId(), t: 'تواصل معنا', t_en: 'Contact us', go: 'contact' });
    return tree.slice(0, MAXO);
  }

  // تنظيف قبل الحفظ: يرجّع {tree} أو {err, path, field}
  function check(tree) {
    let bad = null;
    const walk = (arr, path) => arr.map((o, i) => {
      if (bad) return o;
      const t = String(o.t || '').trim() || String(o.t_en || '').trim();
      if (!t) { bad = { err: 'اكتب اسم الخيار رقم ' + (i + 1), path, field: { o: i } }; return o; }
      if (o.go === 'svc:' || o.go === 'svc') { bad = { err: `اختر الخدمة لـ«${t}»`, path, field: { o: i } }; return o; }
      const n = { id: o.id, t: t.slice(0, 20), go: o.go };
      if (String(o.t_en || '').trim()) n.t_en = String(o.t_en).trim().slice(0, 20);
      if (o.go === 'msg') {
        const text = String(o.text || '').trim() || String(o.text_en || '').trim();
        if (!text) { bad = { err: `اكتب الرسالة اللي تطلع لما يضغط «${t}»`, path: [...path, o.id], field: { text: 1 } }; return o; }
        n.text = text.slice(0, 1000);
        if (String(o.text_en || '').trim()) n.text_en = String(o.text_en).trim().slice(0, 1000);
        n.opts = walk(o.opts || [], [...path, o.id]);
      }
      return n;
    });
    if (!tree.length) return { err: 'أضف خيار واحد على الأقل', path: [], field: {} };
    const out = walk(tree, []);
    return bad || { tree: out };
  }

  function count(arr) { let n = 0; const w = (a) => a.forEach((o) => { if (o.go === 'msg') { n++; w(o.opts || []); } }); w(arr); return n; }
  const clone = (x) => { const c = JSON.parse(JSON.stringify(x)); const re = (n) => { n.id = newId(); (n.opts || []).forEach(re); }; re(c); return c; };

  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style');
    s.textContent = `
.mt{position:relative;display:grid;gap:18px;grid-template-columns:minmax(0,1fr) 340px;align-items:start}
@media (max-width:1180px){.mt{grid-template-columns:minmax(0,1fr) 300px}}
@media (max-width:900px){.mt{grid-template-columns:minmax(0,1fr)}}
.mt-ed{display:grid;gap:14px;min-width:0}
.mt-side{position:sticky;top:84px;display:grid;gap:8px;min-width:0}
@media (min-width:901px){.mt-ed,.mt-mapbox{grid-column:1}.mt-side{grid-column:2;grid-row:1 / span 2}}
@media (max-width:900px){.mt-side{position:static}}
.mt-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.mt-backb{display:inline-flex;align-items:center;gap:4px;border:0;background:var(--soft2);color:var(--fg);border-radius:10px;padding:6px 10px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}
.mt-backb .i{width:16px;height:16px;transform:scaleX(-1)}
.mt-path{display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0;flex:1}
.mt-path button{border:0;background:none;color:var(--muted);font:inherit;font-size:14px;padding:4px 6px;border-radius:8px;cursor:pointer;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-path button:hover{background:var(--soft2);color:var(--fg)}
.mt-path button.on{color:var(--fg);font-weight:700;cursor:default;background:none}
.mt-path .sep{color:var(--line);display:inline-flex}
.mt-path .sep .i{width:14px;height:14px;color:var(--muted);opacity:.6}
.mt-lv{font-size:12px;font-weight:700;color:var(--accent);background:var(--soft);border-radius:99px;padding:3px 10px;white-space:nowrap}
.mt-sec{display:grid;gap:9px}
.mt-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mt-h b{font-family:var(--display);font-size:15px;font-weight:800}
.mt-h span{color:var(--muted);font-size:12.5px}
.mt-h .sp{flex:1}
.mt-tag{display:inline-flex;align-items:center;gap:5px;border-radius:99px;padding:2px 9px;background:var(--soft2);color:var(--muted)!important;font-size:12px!important;font-weight:600}
.mt-tag .i{width:13px;height:13px}
.mt-bub{position:relative;background:var(--card);border:1.5px solid var(--line);border-radius:18px 18px 18px 6px;transition:border-color .15s,box-shadow .15s}
.mt-bub:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.mt-bub textarea{display:block;width:100%;min-height:88px;border:0;background:transparent;resize:vertical;padding:12px 14px 22px;font:inherit;font-size:15px;line-height:1.7;color:var(--fg);outline:0;box-shadow:none;border-radius:inherit}
.mt-bub .len{position:absolute;bottom:6px;inset-inline-end:12px;font-size:11.5px;color:var(--muted)}
.mt-tip{font-size:12.5px;color:var(--muted)}
.mt-tip code{background:var(--soft2);border-radius:6px;padding:0 5px;font-family:inherit;color:var(--fg)}
.mt-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.mt-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;align-items:start;background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:10px 12px 10px 8px;transition:border-color .15s,box-shadow .15s}
.mt-row:focus-within{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}
.mt-row.err{border-color:var(--bad);box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 14%,transparent)}
.mt-num{width:28px;height:28px;border-radius:9px;background:var(--soft);color:var(--accent);display:grid;place-items:center;font-family:var(--display);font-weight:800;font-size:13.5px;margin-top:5px}
.mt-body{display:grid;gap:8px;min-width:0}
.mt-line{display:flex;align-items:center;gap:8px;min-width:0}
.mt-namew{position:relative;flex:1;min-width:0}
.mt-name{width:100%;border:1.5px solid transparent;background:var(--soft2);border-radius:11px;padding:8px 11px;padding-inline-end:46px;font:inherit;font-size:15px;font-weight:600;color:var(--fg);min-height:40px}
.mt-name:hover{border-color:var(--line)}
.mt-name:focus{outline:0;background:var(--card);border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.mt-name::placeholder{font-weight:400;color:var(--muted)}
.mt-namew .len{position:absolute;inset-inline-end:10px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);pointer-events:none}
.mt-type{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--line);background:var(--card);color:var(--fg);border-radius:11px;padding:0 9px 0 7px;min-height:40px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;flex:none}
.mt-type:hover,.mt-type[aria-expanded="true"]{border-color:var(--accent);background:var(--soft)}
.mt-type .i{width:17px;height:17px;color:var(--accent)}
.mt-type .i.c{width:14px;height:14px;color:var(--muted)}
.mt-type.msg{background:var(--soft);border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.mt-more{width:36px;height:40px;border:0;background:none;color:var(--muted);border-radius:10px;display:grid;place-items:center;cursor:pointer;flex:none}
.mt-more:hover,.mt-more[aria-expanded="true"]{background:var(--soft2);color:var(--fg)}
.mt-more .i{width:19px;height:19px}
.mt-sub{display:flex;align-items:center;gap:10px;width:100%;border:0;background:color-mix(in srgb,var(--soft) 70%,var(--card));border-radius:12px;padding:8px 11px;font:inherit;color:var(--fg);cursor:pointer;text-align:start;min-width:0}
.mt-sub:hover{background:var(--soft)}
.mt-sub .q{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;color:var(--muted)}
.mt-sub .q.empty{color:var(--accent);font-weight:600}
.mt-sub .c{font-size:12px;font-weight:700;color:var(--accent);background:var(--card);border-radius:99px;padding:2px 9px;white-space:nowrap}
.mt-sub .go{display:inline-flex;align-items:center;gap:2px;font-size:13px;font-weight:700;color:var(--accent);white-space:nowrap}
.mt-sub .go .i{width:16px;height:16px}
.mt-act{font-size:12.5px;color:var(--muted);padding-inline-start:2px}
.mt-svc{display:flex;align-items:center;gap:8px;min-width:0}
.mt-svc span{font-size:13px;color:var(--muted);white-space:nowrap}
.mt-svc select{flex:1;min-width:0;min-height:38px}
.mt-add{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;min-height:46px;border:1.5px dashed color-mix(in srgb,var(--accent) 40%,var(--line));background:transparent;color:var(--accent);border-radius:16px;font:inherit;font-weight:700;font-size:14.5px;cursor:pointer}
.mt-add:hover{background:var(--soft)}
.mt-add:disabled{color:var(--muted);border-color:var(--line);cursor:default;background:none}
.mt-add .i{width:18px;height:18px}
.mt-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px}
.mt-foot .sp{flex:1}
.mt-dirty{display:none;align-items:center;gap:6px;font-size:13px;color:var(--warn);font-weight:600}
.mt-dirty::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.mt.dirty .mt-dirty{display:inline-flex}
.mt-pop{position:absolute;z-index:40;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 40px -16px rgba(30,20,80,.35);padding:6px;width:280px;max-height:380px;overflow:auto}
.mt-pop .ttl{font-family:var(--display);font-weight:800;font-size:15px;padding:6px 10px 2px}
.mt-pop:not(.sheet) .ttl{display:none}
.mt-pop .g{font-size:11.5px;font-weight:700;color:var(--muted);padding:8px 10px 3px}
.mt-pop button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;border-radius:10px;padding:7px 9px;font:inherit;color:var(--fg);cursor:pointer;text-align:start}
.mt-pop button:hover,.mt-pop button:focus-visible{background:var(--soft2);outline:0}
.mt-pop button.on{background:var(--soft)}
.mt-pop button .ti{width:30px;height:30px;border-radius:9px;background:var(--soft2);display:grid;place-items:center;flex:none;color:var(--accent)}
.mt-pop button.on .ti{background:var(--accent);color:var(--accent-ink)}
.mt-pop button .ti .i{width:16px;height:16px}
.mt-pop button b{display:block;font-size:14px;font-weight:600}
.mt-pop button small{display:block;font-size:12px;color:var(--muted);line-height:1.4}
.mt-pop button.bad{color:var(--bad)} .mt-pop button.bad .ti{color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent)}
.mt-pop button:disabled{opacity:.4;cursor:default;background:none}
.mt-pop.sheet{position:fixed;inset:auto 0 0 0;width:auto;max-height:72vh;border-radius:20px 20px 0 0;padding:8px 10px calc(14px + env(safe-area-inset-bottom))}
.mt-veil{position:fixed;inset:0;z-index:39;background:rgba(10,10,30,.28)}
.mt-map{display:grid;gap:2px}
.mt-tree,.mt-tree ul{list-style:none;margin:0;padding:0}
.mt-tree ul{padding-inline-start:36px}
.mt-tree li{position:relative}
.mt-tree ul>li::before{content:"";position:absolute;inset-inline-start:-13px;top:0;bottom:0;border-inline-start:1.5px solid var(--line)}
.mt-tree ul>li:last-child::before{bottom:auto;height:19px}
.mt-tree ul>li::after{content:"";position:absolute;inset-inline-start:-13px;top:19px;width:11px;border-top:1.5px solid var(--line)}
.mt-node{display:inline-flex;align-items:center;gap:8px;min-height:38px;max-width:100%;border:0;background:none;border-radius:11px;padding:3px 8px 3px 10px;font:inherit;color:var(--fg);text-align:start}
.mt-node .ti{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--soft2);color:var(--muted)}
.mt-node .ti .i{width:15px;height:15px}
.mt-node .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.mt-node small{color:var(--muted);font-size:12px;white-space:nowrap}
button.mt-node{cursor:pointer}
button.mt-node .ti{background:var(--soft);color:var(--accent)}
button.mt-node .t{font-weight:700}
button.mt-node:hover{background:var(--soft2)}
button.mt-node.on{background:var(--soft);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 45%,transparent)}
button.mt-node.on .ti{background:var(--accent);color:var(--accent-ink)}
.mt-mapbox{border:1px solid var(--line);border-radius:18px;padding:12px 12px 10px;background:var(--card)}
@media (max-width:560px){
  .mt-lv{display:none}
  .mt-tree ul{padding-inline-start:30px}
  .mt-tree ul>li::before,.mt-tree ul>li::after{inset-inline-start:-7px}
  .mt-tree ul>li::after{width:5px}
  .mt-line{flex-wrap:wrap}
  .mt-namew{flex:1 1 100%}
  .mt-type{flex:1;justify-content:flex-start}
  .mt-row{padding:10px 10px 10px 8px;gap:8px;grid-template-columns:24px minmax(0,1fr)}
  .mt-num{width:24px;height:24px;font-size:12.5px;border-radius:8px}
}
/* جوال بشكل واتساب */
.mt-phone{--wa-head:#008069;--wa-head-ink:#fff;--wa-wall:#EFEAE2;--wa-dot:rgba(0,0,0,.035);--wa-in:#fff;--wa-out:#D9FDD3;--wa-ink:#111B21;--wa-sub:#667781;--wa-link:#027EB5;--wa-sep:#E9EDEF;--wa-note:#FFF5C4;--wa-note-ink:#54656F;--wa-bar:#F0F2F5;
  border-radius:30px;padding:8px;background:linear-gradient(160deg,#2A2B3D,#14151F);box-shadow:0 24px 50px -28px rgba(20,16,60,.6)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .mt-phone{--wa-head:#202C33;--wa-head-ink:#E9EDEF;--wa-wall:#0B141A;--wa-dot:rgba(255,255,255,.03);--wa-in:#202C33;--wa-out:#005C4B;--wa-ink:#E9EDEF;--wa-sub:#8696A0;--wa-link:#53BDEB;--wa-sep:#2A3942;--wa-note:#1D2A30;--wa-note-ink:#C9D3D8;--wa-bar:#1F2C33}}
:root[data-theme="dark"] .mt-phone{--wa-head:#202C33;--wa-head-ink:#E9EDEF;--wa-wall:#0B141A;--wa-dot:rgba(255,255,255,.03);--wa-in:#202C33;--wa-out:#005C4B;--wa-ink:#E9EDEF;--wa-sub:#8696A0;--wa-link:#53BDEB;--wa-sep:#2A3942;--wa-note:#1D2A30;--wa-note-ink:#C9D3D8;--wa-bar:#1F2C33}
.ph-in-wrap{border-radius:23px;overflow:hidden;display:flex;flex-direction:column;height:540px;background:var(--wa-wall)}
@media (max-width:900px){.ph-in-wrap{height:auto;min-height:360px}}
.ph-head{display:flex;align-items:center;gap:10px;background:var(--wa-head);color:var(--wa-head-ink);padding:12px 14px 10px}
.ph-av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;font-family:var(--display);font-weight:800;overflow:hidden;flex:none}
.ph-av img{width:100%;height:100%;object-fit:cover;background:#fff}
.ph-head b{display:block;font-size:15px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ph-head small{display:block;font-size:12px;opacity:.8}
.ph-chat{flex:1;overflow:auto;padding:12px 10px 14px;display:flex;flex-direction:column;gap:6px;background-color:var(--wa-wall);background-image:radial-gradient(var(--wa-dot) 1.2px,transparent 1.2px);background-size:16px 16px}
.ph-day{align-self:center;background:var(--wa-in);color:var(--wa-sub);font-size:11.5px;border-radius:8px;padding:3px 10px;box-shadow:0 1px .5px rgba(11,20,26,.13);margin-bottom:4px}
.ph-msg{max-width:86%;border-radius:10px;padding:6px 9px 4px;box-shadow:0 1px .5px rgba(11,20,26,.13);color:var(--wa-ink);font-size:14px;line-height:1.55}
.ph-msg p{margin:0;white-space:pre-wrap;word-break:break-word}
.ph-msg time{display:block;text-align:end;font-size:10.5px;color:var(--wa-sub);margin-top:1px}
.ph-msg.in{align-self:flex-start;background:var(--wa-in);border-start-start-radius:3px}
.ph-msg.out{align-self:flex-end;background:var(--wa-out);border-start-end-radius:3px}
.ph-msg.in.btns{border-end-start-radius:4px;border-end-end-radius:4px}
.ph-grp{align-self:flex-start;width:min(86%,290px);display:grid;gap:2px}
.ph-grp .ph-msg{max-width:none}
.ph-btns{display:grid;gap:2px}
.ph-btns button,.ph-lbtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;border:0;background:var(--wa-in);color:var(--wa-link);font:inherit;font-size:14px;font-weight:600;padding:9px 8px;cursor:pointer;box-shadow:0 1px .5px rgba(11,20,26,.13)}
.ph-btns button:last-child{border-radius:0 0 10px 10px}
.ph-btns button .i,.ph-lbtn .i{width:15px;height:15px}
.ph-btns button:hover,.ph-lbtn:hover,.ph-sheet button:hover{filter:brightness(.97)}
.ph-lbtn{border-top:1px solid var(--wa-sep);box-shadow:none;margin:6px -9px -4px;width:calc(100% + 18px);border-radius:0 0 10px 10px;background:none}
.ph-sheet{align-self:stretch;background:var(--wa-in);border-radius:14px;box-shadow:0 1px .5px rgba(11,20,26,.13);overflow:hidden;margin-top:2px}
.ph-sheet .hd{text-align:center;font-weight:700;font-size:14px;color:var(--wa-ink);padding:9px;border-bottom:1px solid var(--wa-sep)}
.ph-sheet button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;border-bottom:1px solid var(--wa-sep);background:var(--wa-in);color:var(--wa-ink);font:inherit;font-size:14px;padding:10px 14px;cursor:pointer;text-align:start}
.ph-sheet button:last-child{border-bottom:0}
.ph-sheet button i{width:17px;height:17px;border:2px solid var(--wa-sub);border-radius:50%;flex:none}
.ph-note{align-self:center;max-width:92%;background:var(--wa-note);color:var(--wa-note-ink);font-size:12px;line-height:1.5;border-radius:8px;padding:5px 10px;text-align:center;box-shadow:0 1px .5px rgba(11,20,26,.1);margin-top:4px}
.ph-bar{display:flex;align-items:center;gap:8px;padding:7px 8px 9px;background:var(--wa-bar)}
.ph-bar span{flex:1;background:var(--wa-in);color:var(--wa-sub);border-radius:20px;padding:7px 14px;font-size:13.5px}
.ph-bar i{width:34px;height:34px;border-radius:50%;background:#00A884;flex:none}
.mt-sidecap{font-size:12.5px;color:var(--muted);text-align:center}`;
    document.head.appendChild(s);
  }

  let closeDoc = null;
  function mount(el, o) {
    style();
    const D = o.draft, en = o.lang === 'en';
    if (!Array.isArray(D.path)) D.path = [];
    const svcs = (o.services || []).filter((s) => s.active !== false);
    const svcOf = (x) => svcs.find((s) => 'svc:' + s.id === x.go);
    let note = '', sheet = false;
    const now = new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
    const dirty = () => { D.dirty = true; const m = el.querySelector('.mt'); if (m) m.classList.add('dirty'); };
    // الرسالة الحالية من المسار (لو انحذفت وحدة منه نرجع لأقرب موجودة)
    function at() {
      let arr = D.tree, node = null; const ok = [], nodes = [];
      for (const id of D.path) { const n = arr.find((x) => x.id === id && x.go === 'msg'); if (!n) break; ok.push(id); nodes.push(n); node = n; n.opts = n.opts || []; arr = n.opts; }
      D.path = ok;
      return { node, opts: arr, nodes };
    }
    const labelOf = (x) => (en ? (x.t_en || x.t) : (x.t || x.t_en)) || '';
    const defLabel = (k, svc) => k === 'svc' ? (svc ? (en ? (svc.name_en || svc.name) : svc.name) : '') : (ACT[k] ? ACT[k][en ? 4 : 3] : '');
    const shown = (x) => labelOf(x) || defLabel(kindOf(x), svcOf(x)) || '…';
    const msgText = (n) => n ? (en ? (n.text_en || n.text) : (n.text || n.text_en)) || '' : (D.welcome[en ? 'en' : 'ar'] || D.def[en ? 'en' : 'ar']);
    const fill = (t) => String(t || '').replace(/\{biz\}/g, o.bizName || '');
    const go = (path) => { D.path = path; note = ''; sheet = false; closePop(); paint(); };

    function paint() {
      const { node, opts, nodes } = at();
      const crumbs = [`<button type="button" data-p="-1" class="${node ? '' : 'on'}">أول رسالة</button>`];
      nodes.forEach((n, i) => crumbs.push(`<span class="sep">${ic('chev')}</span><button type="button" data-p="${i}" class="${i === nodes.length - 1 ? 'on' : ''}">${esc(labelOf(n) || 'بدون اسم')}</button>`));
      const rows = opts.map((x, i) => {
        const k = kindOf(x), a = ACT[k], lbl = en ? (x.t_en || '') : (x.t || '');
        const ph = en ? (x.t || defLabel(k, svcOf(x)) || 'Button name') : (defLabel(k, svcOf(x)) || 'اسم الزر');
        let sub = '';
        if (k === 'msg') { const c = (x.opts || []).length, q = msgText(x); sub = `<button type="button" class="mt-sub" data-open="${i}"><span class="q ${q ? '' : 'empty'}">${esc(q ? q.replace(/\s+/g, ' ') : 'اكتب الرسالة اللي تطلع له وخياراتها')}</span>${c ? `<span class="c">${nOpts(c)}</span>` : ''}<span class="go">افتح${ic('chev')}</span></button>`; }
        else if (k === 'svc') { const cur = x.go.slice(4); sub = `<div class="mt-svc"><span>الخدمة</span><select data-svc="${i}" aria-label="الخدمة"><option value="">اختر الخدمة</option>${svcs.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`; }
        else sub = `<div class="mt-act">${esc(a[2])}</div>`;
        return `<li class="mt-row" data-i="${i}"><span class="mt-num">${i + 1}</span><div class="mt-body">
          <div class="mt-line"><span class="mt-namew"><input class="mt-name" data-name="${i}" value="${esc(lbl)}" maxlength="20" placeholder="${esc(ph)}" aria-label="اسم الزر ${i + 1}" ${en ? 'dir="ltr"' : ''}><span class="len">${[...lbl].length}/20</span></span>
          <button type="button" class="mt-type ${k === 'msg' ? 'msg' : ''}" data-type="${i}" aria-haspopup="menu" aria-expanded="false">${ic(a[5])}${esc(a[1])}${ic('down').replace('class="i"', 'class="i c"')}</button>
          <button type="button" class="mt-more" data-more="${i}" aria-haspopup="menu" aria-expanded="false" aria-label="ترتيب وحذف">${ic('dots')}</button></div>
          ${sub}</div></li>`;
      }).join('');
      const txt = node ? (en ? (node.text_en || '') : (node.text || '')) : (D.welcome[en ? 'en' : 'ar'] || D.def[en ? 'en' : 'ar']);
      el.innerHTML = `<div class="mt ${D.dirty ? 'dirty' : ''}">
        <div class="mt-ed">
          ${node ? `<div class="mt-top"><button type="button" class="mt-backb" data-p="${nodes.length - 2}">${ic('chev')}رجوع</button><nav class="mt-path" aria-label="وين أنت في الشجرة">${crumbs.join('')}</nav><span class="mt-lv">المستوى ${nodes.length + 1}</span></div>` : ''}
          <section class="mt-sec">
            <div class="mt-h"><b>${node ? `الرسالة لما يضغط «${esc(labelOf(node) || '…')}»` : 'أول رسالة يشوفها العميل'}</b><span>تطلع فوق الخيارات</span></div>
            <div class="mt-bub"><textarea id="mtText" rows="3" maxlength="1000" ${en ? 'dir="ltr"' : ''} placeholder="${esc(node ? (en ? (node.text || 'Message') : 'مثل: اختر الخدمة 👇') : D.def[en ? 'en' : 'ar'])}">${esc(txt)}</textarea><span class="len" id="mtTlen">${[...txt].length}/1000</span></div>
            ${node ? '' : `<div class="mt-tip">اكتب <code>{biz}</code> ويطلع مكانها اسم محلك</div>`}
          </section>
          <section class="mt-sec">
            <div class="mt-h"><b>الخيارات تحتها</b>${opts.length ? `<span class="mt-tag">${opts.length <= 3 ? ic('reply') + 'تطلع أزرار' : ic('list') + 'تطلع قائمة'}</span>` : ''}<span class="sp"></span><span>${opts.length} من ${MAXO}</span></div>
            ${rows ? `<ol class="mt-list">${rows}</ol>` : `<div class="mt-act" style="padding:4px 2px">ما فيه خيارات، يعني يرد بالرسالة وتحتها أزرار «تحت كل جواب».</div>`}
            <button type="button" class="mt-add" id="mtAdd" ${opts.length >= MAXO ? 'disabled' : ''}>${icon('plus')}${opts.length >= MAXO ? 'وصلت 10 خيارات' : 'أضف خيار'}</button>
          </section>
          <div class="mt-foot">${node ? '' : `<button class="btn sm ghost" type="button" id="mtStarter">${ic('wand')}جهّزها من خدماتي</button>`}<span class="sp"></span><span class="mt-dirty">تعديلات ما انحفظت</span><button class="btn" type="button" id="mtSave">${icon('check')}حفظ الردود</button></div>
        </div>
        <aside class="mt-side"><div class="mt-phone"><div class="ph-in-wrap">
          <div class="ph-head"><span class="ph-av">${o.logo ? `<img src="${esc(o.logo)}" alt="">` : esc((o.bizName || 'م').trim().charAt(0))}</span><div style="min-width:0"><b>${esc(o.bizName || '')}</b><small>${en ? 'Business account' : 'حساب تجاري'}</small></div></div>
          <div class="ph-chat" id="mtChat"></div>
          <div class="ph-bar" aria-hidden="true"><span>${en ? 'Message' : 'اكتب رسالة'}</span><i></i></div>
        </div></div><div class="mt-sidecap">اضغط الأزرار وامشِ في الردود مثل العميل</div></aside>
        <section class="mt-sec mt-mapbox"><div class="mt-h"><b>خريطة الردود</b><span>${count(D.tree) + 1} رسائل · اضغط أي رسالة تروح لها</span></div><div class="mt-map" id="mtMap"></div></section></div>`;
      bind(node, opts);
      side();
    }

    // الجوال والخريطة يتحدثون مع الكتابة بدون ما يضيع المؤشر
    function side() {
      const { node, opts, nodes } = at();
      const rows = opts.map((x) => ({ x, t: shown(x) }));
      const body = fill(msgText(node)) || '…';
      let h = `<div class="ph-day">${en ? 'Today' : 'اليوم'}</div>`;
      if (!node) h += `<div class="ph-msg out"><p>${en ? 'Hi' : 'السلام عليكم'}</p><time>${now}</time></div>`;
      else h += `<div class="ph-msg out"><p>${esc(labelOf(nodes[nodes.length - 1]) || '…')}</p><time>${now}</time></div>`;
      if (rows.length && rows.length <= 3) {
        h += `<div class="ph-grp"><div class="ph-msg in btns"><p>${esc(body)}</p><time>${now}</time></div><div class="ph-btns">${rows.map((r, i) => `<button type="button" data-tap="${i}">${ic('reply')}${esc(r.t)}</button>`).join('')}</div></div>`;
      } else if (rows.length) {
        h += `<div class="ph-grp"><div class="ph-msg in"><p>${esc(body)}</p><time>${now}</time><button type="button" class="ph-lbtn" id="mtLbtn">${ic('list')}${en ? 'More options' : 'خيارات أكثر'}</button></div></div>`;
        if (sheet) h += `<div class="ph-sheet"><div class="hd">${en ? 'More options' : 'خيارات أكثر'}</div>${rows.map((r, i) => `<button type="button" data-tap="${i}"><span>${esc(r.t)}</span><i></i></button>`).join('')}</div>`;
      } else h += `<div class="ph-msg in"><p>${esc(body)}</p><time>${now}</time></div>`;
      if (note) h += `<div class="ph-note">${esc(note)}</div>`;
      const ch = el.querySelector('#mtChat'); ch.innerHTML = h;
      const lb = ch.querySelector('#mtLbtn'); if (lb) lb.onclick = () => { sheet = !sheet; side(); };
      ch.querySelectorAll('[data-tap]').forEach((b) => b.onclick = () => {
        const x = rows[+b.dataset.tap].x, k = kindOf(x);
        if (k === 'msg') return go([...D.path, x.id]);
        if (k === 'back') return go(D.path.slice(0, -1));
        if (k === 'home') return go([]);
        note = k === 'svc' ? (svcOf(x) ? `يبدأ حجز «${svcOf(x).name}» على طول` : 'اختر الخدمة لهالزر') : ACT[k][2];
        sheet = false; side();
      });
      ch.scrollTop = ch.scrollHeight;
      // الخريطة
      const li = (arr, path) => arr.map((x) => {
        const k = kindOf(x), t = esc(shown(x));
        if (k === 'msg') { const p = [...path, x.id], on = p.join('/') === D.path.join('/'), c = (x.opts || []).length; return `<li><button type="button" class="mt-node ${on ? 'on' : ''}" data-go="${p.join('/')}"><span class="ti">${ic('chat')}</span><span class="t">${t}</span><small>${c ? nOpts(c) : 'رسالة بس'}</small></button>${c ? `<ul>${li(x.opts, p)}</ul>` : ''}</li>`; }
        const what = k === 'svc' ? 'يحجز ' + ((svcOf(x) || {}).name || '؟') : ACT[k][1];
        return `<li><span class="mt-node"><span class="ti">${ic(ACT[k][5])}</span><span class="t">${t}</span>${what !== shown(x) ? `<small>${esc(what)}</small>` : ''}</span></li>`;
      }).join('');
      const map = el.querySelector('#mtMap');
      map.innerHTML = `<ul class="mt-tree"><li><button type="button" class="mt-node ${D.path.length ? '' : 'on'}" data-go=""><span class="ti">${ic('chat')}</span><span class="t">أول رسالة</span><small>${nOpts(D.tree.length)}</small></button>${D.tree.length ? `<ul>${li(D.tree, [])}</ul>` : ''}</li></ul>`;
      map.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go ? b.dataset.go.split('/') : []));
    }

    // القوائم الصغيرة (نوع الزر، ترتيب وحذف): فوق الزر بالكمبيوتر، ومن تحت بالجوال
    let pop = null, veil = null, popBtn = null;
    function closePop() {
      if (pop) pop.remove(); if (veil) veil.remove(); pop = veil = null;
      if (popBtn) { popBtn.setAttribute('aria-expanded', 'false'); popBtn = null; }
    }
    function openPop(btn, html, onPick) {
      const again = popBtn === btn; closePop(); if (again) return;
      const root = el.querySelector('.mt'), small = innerWidth <= 560;
      pop = document.createElement('div'); pop.className = 'mt-pop' + (small ? ' sheet' : ''); pop.setAttribute('role', 'menu'); pop.innerHTML = html;
      if (small) { veil = document.createElement('div'); veil.className = 'mt-veil'; veil.onclick = closePop; document.body.append(veil, pop); }
      else {
        root.appendChild(pop);
        const r = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
        const left = Math.max(0, Math.min(rr.width - pop.offsetWidth, r.right - rr.left - pop.offsetWidth));
        pop.style.left = left + 'px';
        const below = r.bottom - rr.top + 6, room = innerHeight - r.bottom;
        pop.style.top = (room < pop.offsetHeight + 16 && r.top > pop.offsetHeight + 16 ? r.top - rr.top - pop.offsetHeight - 6 : below) + 'px';
      }
      popBtn = btn; btn.setAttribute('aria-expanded', 'true');
      pop.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { const v = b.dataset.v; closePop(); onPick(v); });
      const first = pop.querySelector('button.on') || pop.querySelector('button:not(:disabled)'); if (first) first.focus();
    }
    if (closeDoc) document.removeEventListener('mousedown', closeDoc, true);
    closeDoc = (e) => { if (pop && !pop.contains(e.target) && e.target !== popBtn && !(popBtn && popBtn.contains(e.target))) closePop(); };
    document.addEventListener('mousedown', closeDoc, true);
    el.onkeydown = (e) => { if (e.key === 'Escape' && pop) { const b = popBtn; closePop(); if (b) b.focus(); } };

    function bind(node, opts) {
      el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => go(D.path.slice(0, +b.dataset.p + 1)));
      const ta = el.querySelector('#mtText');
      ta.oninput = () => {
        const v = ta.value;
        if (node) node[en ? 'text_en' : 'text'] = v; else D.welcome[en ? 'en' : 'ar'] = v;
        el.querySelector('#mtTlen').textContent = [...v].length + '/1000';
        dirty(); side();
      };
      el.querySelectorAll('[data-name]').forEach((inp) => inp.oninput = () => {
        opts[+inp.dataset.name][en ? 't_en' : 't'] = inp.value;
        inp.nextElementSibling.textContent = [...inp.value].length + '/20';
        inp.closest('.mt-row').classList.remove('err');
        dirty(); side();
      });
      el.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.type, x = opts[i], cur = kindOf(x);
        const html = '<div class="ttl">وش يسوي الزر؟</div>' + GROUPS.map(([g, ks]) => { const list = ks.filter((k) => k !== 'svc' || svcs.length); return list.length ? `<div class="g">${g}</div>` + list.map((k) => `<button type="button" role="menuitem" data-v="${k}" class="${k === cur ? 'on' : ''}"><span class="ti">${ic(ACT[k][5])}</span><span><b>${esc(ACT[k][1])}</b><small>${esc(ACT[k][2])}</small></span></button>`).join('') : ''; }).join('');
        openPop(b, html, (k) => {
          if (k === cur) return;
          const wasDef = !x.t || x.t === defLabel(cur, svcOf(x));
          x.go = k === 'svc' ? 'svc:' : k;
          if (k === 'msg') { x.opts = x.opts || []; x.text = x.text || ''; }
          if (wasDef && k !== 'msg' && k !== 'svc') { x.t = ACT[k][3]; x.t_en = ACT[k][4]; }
          dirty(); paint();
          const nb = el.querySelector(`[data-type="${i}"]`); if (nb) nb.focus();
        });
      });
      el.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.more;
        const html = `<button type="button" role="menuitem" data-v="up" ${i ? '' : 'disabled'}><span class="ti">${ic('up')}</span><b>انقله فوق</b></button><button type="button" role="menuitem" data-v="down" ${i < opts.length - 1 ? '' : 'disabled'}><span class="ti">${ic('down')}</span><b>انقله تحت</b></button><button type="button" role="menuitem" data-v="dup" ${opts.length < MAXO ? '' : 'disabled'}><span class="ti">${ic('dup')}</span><span><b>نسخة منه</b><small>مع كل اللي تحته</small></span></button><button type="button" role="menuitem" class="bad" data-v="del"><span class="ti">${icon('trash')}</span><b>احذفه</b></button>`;
        openPop(b, html, (v) => {
          if (v === 'up' && i) [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]];
          else if (v === 'down' && i < opts.length - 1) [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]];
          else if (v === 'dup' && opts.length < MAXO) opts.splice(i + 1, 0, clone(opts[i]));
          else if (v === 'del') {
            const x = opts[i];
            if (x.go === 'msg' && ((x.opts || []).length || (x.text || '').trim()) && !confirm(`حذف «${labelOf(x) || 'الخيار'}» ورسالته وكل اللي تحته؟`)) return;
            opts.splice(i, 1);
          } else return;
          dirty(); paint();
        });
      });
      el.querySelectorAll('[data-svc]').forEach((s) => s.onchange = () => {
        const x = opts[+s.dataset.svc], sv = svcs.find((y) => y.id === s.value), prev = svcOf(x);
        if (!x.t || (prev && x.t === prev.name.slice(0, 20))) { x.t = sv ? sv.name.slice(0, 20) : ''; x.t_en = sv && sv.name_en ? sv.name_en.slice(0, 20) : ''; }
        x.go = 'svc:' + (sv ? sv.id : ''); dirty(); paint();
      });
      el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { go([...D.path, opts[+b.dataset.open].id]); el.querySelector('#mtText').focus(); });
      el.querySelector('#mtAdd').onclick = () => {
        if (opts.length >= MAXO) return;
        opts.push({ id: newId(), t: '', go: 'msg', text: '', opts: [] }); dirty(); paint();
        const ins = el.querySelectorAll('[data-name]'); if (ins.length) ins[ins.length - 1].focus();
      };
      const st = el.querySelector('#mtStarter');
      if (st) st.onclick = () => { if (D.tree.length && !confirm('تبدّل الخيارات الحالية بشجرة جاهزة من خدماتك وأسئلتك؟')) return; D.tree.splice(0, D.tree.length, ...starter(svcs, o.faq)); dirty(); go([]); };
      el.querySelector('#mtSave').onclick = async (e) => {
        const r = check(D.tree);
        if (r.err) {
          go(r.path); I.toast(r.err, true);
          if (r.field.text) el.querySelector('#mtText').focus();
          else if (r.field.o != null) { const row = el.querySelector(`.mt-row[data-i="${r.field.o}"]`); if (row) { row.classList.add('err'); row.querySelector('input').focus(); } }
          return;
        }
        e.currentTarget.disabled = true;
        try { if (await o.onSave(r.tree) !== false) { D.dirty = false; const m = el.querySelector('.mt'); if (m) m.classList.remove('dirty'); } }
        finally { const b = el.querySelector('#mtSave'); if (b) b.disabled = false; }
      };
    }
    paint();
  }

  window.MenuTree = { mount, fromMain, starter, check, count };
})();
