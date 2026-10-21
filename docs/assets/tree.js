// الردود: المالك يضبط ردود واتساب كأنه يشوفها في الجوال: رسالة فوق، وأزرار تحتها، وكل زر يا يفتح رسالة ثانية يا يسوي شي على طول.
// MenuTree.mount(el, { draft, lang, bizName, logo, services, faq, onSave }) · draft = { tree: [...], welcome: {ar, en}, def: {ar, en}, path: [] }
// العقدة: { id, t, t_en, go, text, text_en, opts } · go: msg أو إجراء (نفس اللي يفهمه الرد الآلي في _shared/bot.ts)
(function () {
  const I = window.IHJ, { esc, icon } = I;
  // [المفتاح، اسم قصير، وصف قصير، اسم الزر عربي، إنجليزي، الأيقونة]
  const ACTS = [
    ['msg', 'يفتح رسالة', 'رسالة ثانية لها أزرارها', '', '', 'chat'],
    ['book', 'يبدأ الحجز', 'الخدمة واليوم والوقت', 'احجز من هنا', 'Book now', 'cal'],
    ['prices', 'الأسعار', 'يرد بأسعار خدماتك', 'الأسعار', 'Prices', 'sale'],
    ['location', 'موقعنا', 'يرد بموقعكم أو المدن', 'موقعنا', 'Location', 'pin'],
    ['hours', 'الدوام', 'يرد بأوقات الدوام', 'الدوام', 'Hours', 'clock'],
    ['contact', 'يحوّله لكم', 'تجيك محادثته وترد بنفسك', 'تواصل معنا', 'Contact us', 'users'],
    ['services', 'الخدمات', 'يرد بقائمة خدماتك', 'الخدمات', 'Services', 'box'],
    ['pay', 'طريقة الدفع', 'يرد بطريقة الدفع', 'طريقة الدفع', 'Payment', 'money'],
    ['orders', 'طلباته', 'يعرضها ويعدّل عليها', 'طلباتي', 'My orders', 'orders'],
    ['packages', 'البكجات', 'يعرضها ويشتري', 'البكجات', 'Packages', 'file'],
    ['balance', 'رصيده', 'رصيده من البكجات', 'رصيدي', 'My balance', 'money'],
    ['lang', 'يغيّر اللغة', 'عربي أو English', 'English', 'عربي', 'globe'],
    ['svc', 'يحجز خدمة', 'خدمة وحدة على طول', '', '', 'check'],
    ['back', 'رجوع', 'للرسالة اللي قبل', 'رجوع', 'Back', 'back'],
    ['home', 'أول رسالة', 'يرجع للبداية', 'القائمة', 'Menu', 'home'],
  ];
  const ACT = Object.fromEntries(ACTS.map((a) => [a[0], a]));
  const MAIN = ['msg', 'book', 'prices', 'location', 'hours', 'contact'];
  const MORE = ['services', 'pay', 'orders', 'packages', 'balance', 'lang', 'svc', 'back', 'home'];
  const MAXO = 10;
  const newId = () => (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '').padEnd(8, 'x');
  const kindOf = (o) => (o.go || '').startsWith('svc:') ? 'svc' : (o.go || 'msg');
  const nOpts = (c) => c === 1 ? 'زر واحد' : c === 2 ? 'زران' : c + ' أزرار';
  const backBtn = () => ({ id: newId(), t: 'رجوع', t_en: 'Back', go: 'back' });

  const XI = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    chev: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
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
      if (f) { const e = (faq || [])[+f[1]]; if (e && e.a) out.push({ id: newId(), t: String(e.chip || e.q || 'سؤال').slice(0, 20), go: 'msg', text: e.a, opts: [backBtn()] }); continue; }
      if (ACT[k]) out.push({ id: newId(), t: ACT[k][3], t_en: ACT[k][4], go: k });
    }
    return out;
  }

  // شجرة جاهزة من بيانات المنشأة نفسها: احجز، خدماتنا (كل خدمة رسالة بسعرها وزر يحجزها)، أسئلة، تواصل
  function starter(services, faq) {
    const svcs = (services || []).filter((s) => s.active !== false).slice(0, 9);
    const price = (s) => s.price == null ? 'السعر بعد المعاينة' : `${s.price_from ? 'يبدأ من ' : ''}${I.money(s.price)} ريال`;
    const tree = [{ id: newId(), t: 'احجز من هنا', t_en: 'Book now', go: 'book' }];
    if (svcs.length) tree.push({ id: newId(), t: 'خدماتنا', t_en: 'Our services', go: 'msg', text: 'اختر الخدمة وأعطيك تفاصيلها 👇', text_en: 'Pick a service to see the details 👇', opts: svcs.map((s) => ({ id: newId(), t: String(s.name).slice(0, 20), t_en: String(s.name_en || '').slice(0, 20), go: 'msg', text: `${s.name}\n${price(s)}`, opts: [{ id: newId(), t: 'احجز هالخدمة', t_en: 'Book this', go: 'svc:' + s.id }, backBtn()] })) });
    const qs = (faq || []).filter((e) => e && e.a).slice(0, 8);
    if (qs.length) tree.push({ id: newId(), t: 'أسئلة شائعة', t_en: 'FAQ', go: 'msg', text: 'وش سؤالك؟', text_en: 'What would you like to know?', opts: [...qs.map((e) => ({ id: newId(), t: String(e.chip || String(e.q || '').split(/[,،]/)[0] || 'سؤال').slice(0, 20), go: 'msg', text: e.a, opts: [backBtn()] })), backBtn()] });
    tree.push({ id: newId(), t: 'تواصل معنا', t_en: 'Contact us', go: 'contact' });
    return tree.slice(0, MAXO);
  }

  // تنظيف قبل الحفظ: يرجّع {tree} أو {err, path, field}
  function check(tree) {
    let bad = null;
    const walk = (arr, path) => arr.map((o, i) => {
      if (bad) return o;
      const t = String(o.t || '').trim() || String(o.t_en || '').trim();
      if (!t) { bad = { err: 'اكتب اسم الزر رقم ' + (i + 1), path, field: { o: i } }; return o; }
      if (o.go === 'svc:' || o.go === 'svc') { bad = { err: `اختر الخدمة اللي يحجزها زر «${t}»`, path, field: { o: i, act: 1 } }; return o; }
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
    if (!tree.length) return { err: 'أضف زر واحد على الأقل', path: [], field: {} };
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
.rt{position:relative;display:grid;gap:18px;grid-template-columns:minmax(0,470px) minmax(240px,1fr);align-items:start}
@media (max-width:900px){.rt{grid-template-columns:minmax(0,1fr)}}
.rt-main{display:grid;gap:12px;min-width:0}
/* الجوال بشكل واتساب، وهو المحرّر نفسه */
.rt-phone{--wa-head:#008069;--wa-head-ink:#fff;--wa-wall:#EFEAE2;--wa-dot:rgba(0,0,0,.035);--wa-in:#fff;--wa-out:#D9FDD3;--wa-ink:#111B21;--wa-sub:#667781;--wa-link:#027EB5;--wa-sep:#E9EDEF;--wa-soft:rgba(2,126,181,.09);--wa-hover:rgba(0,0,0,.04);
  border-radius:30px;padding:8px;background:linear-gradient(160deg,#2A2B3D,#14151F);box-shadow:0 24px 50px -28px rgba(20,16,60,.6)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .rt-phone{--wa-head:#202C33;--wa-head-ink:#E9EDEF;--wa-wall:#0B141A;--wa-dot:rgba(255,255,255,.03);--wa-in:#202C33;--wa-out:#005C4B;--wa-ink:#E9EDEF;--wa-sub:#8696A0;--wa-link:#53BDEB;--wa-sep:#2A3942;--wa-soft:rgba(83,189,235,.14);--wa-hover:rgba(255,255,255,.05)}}
:root[data-theme="dark"] .rt-phone{--wa-head:#202C33;--wa-head-ink:#E9EDEF;--wa-wall:#0B141A;--wa-dot:rgba(255,255,255,.03);--wa-in:#202C33;--wa-out:#005C4B;--wa-ink:#E9EDEF;--wa-sub:#8696A0;--wa-link:#53BDEB;--wa-sep:#2A3942;--wa-soft:rgba(83,189,235,.14);--wa-hover:rgba(255,255,255,.05)}
.rt-wrap{border-radius:23px;overflow:hidden;background:var(--wa-wall);display:flex;flex-direction:column}
.rt-head{display:flex;align-items:center;gap:10px;background:var(--wa-head);color:var(--wa-head-ink);padding:10px 12px}
.rt-back{width:36px;height:36px;border:0;background:rgba(255,255,255,.16);color:inherit;border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:none}
.rt-back:hover{background:rgba(255,255,255,.26)}
.rt-back .i{width:20px;height:20px;transform:scaleX(-1)}
.rt-av{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;font-family:var(--display);font-weight:800;overflow:hidden;flex:none}
.rt-av img{width:100%;height:100%;object-fit:cover;background:#fff}
.rt-head b{display:block;font-size:15px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-head small{display:block;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-crumbs{display:flex;flex-wrap:wrap;gap:3px;align-items:center;padding:8px 10px 0;font-size:12.5px}
.rt-crumbs button{border:0;background:var(--wa-in);color:var(--wa-sub);border-radius:99px;padding:3px 10px;font:inherit;font-size:12.5px;cursor:pointer;box-shadow:0 1px .5px rgba(11,20,26,.13);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-crumbs button:hover{color:var(--wa-ink)}
.rt-crumbs button.on{color:var(--wa-ink);font-weight:700;cursor:default}
.rt-crumbs i{color:var(--wa-sub);font-style:normal;opacity:.6}
.rt-chat{padding:12px 10px 14px;display:flex;flex-direction:column;gap:6px;min-height:320px;background-image:radial-gradient(var(--wa-dot) 1.2px,transparent 1.2px);background-size:16px 16px}
.rt-day{align-self:center;background:var(--wa-in);color:var(--wa-sub);font-size:11.5px;border-radius:8px;padding:3px 10px;box-shadow:0 1px .5px rgba(11,20,26,.13);margin-bottom:4px}
.rt-out{align-self:flex-end;max-width:72%;background:var(--wa-out);color:var(--wa-ink);border-radius:10px;border-start-end-radius:3px;padding:6px 9px 4px;box-shadow:0 1px .5px rgba(11,20,26,.13);font-size:14px;line-height:1.5}
.rt-out p{margin:0;white-space:pre-wrap}
.rt-out time,.rt-in time{display:block;text-align:end;font-size:10.5px;color:var(--wa-sub)}
.rt-in{position:relative;align-self:stretch;background:var(--wa-in);border-radius:10px 10px 3px 3px;border-start-start-radius:3px;padding:6px 10px 5px;box-shadow:0 1px .5px rgba(11,20,26,.13);transition:box-shadow .15s}
.rt-in:focus-within{box-shadow:0 0 0 2px var(--wa-link)}
.rt-in textarea{display:block;width:100%;border:0;background:transparent;resize:none;padding:4px 26px 2px 0;font:inherit;font-size:14.5px;line-height:1.6;color:var(--wa-ink);outline:0;box-shadow:none;min-height:46px;overflow:hidden;border-radius:0}
.rt-in textarea[dir="ltr"]{padding:4px 0 2px 26px}
.rt-in textarea::placeholder{color:var(--wa-sub)}
.rt-in .pen{position:absolute;top:8px;inset-inline-end:9px;color:var(--wa-sub);opacity:.55;pointer-events:none}
.rt-in .pen .i{width:15px;height:15px}
.rt-in:focus-within .pen{opacity:0}
.rt-list{align-self:stretch;display:grid;gap:2px}
.rt-btn{display:flex;align-items:center;gap:6px;background:var(--wa-in);padding:4px 6px 4px 8px;box-shadow:0 1px .5px rgba(11,20,26,.13);min-height:46px;transition:box-shadow .15s}
.rt-btn:last-of-type{border-radius:0 0 10px 10px}
.rt-btn.err{box-shadow:inset 0 0 0 2px var(--bad)}
.rt-btn .ti{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:var(--wa-link);background:var(--wa-soft);flex:none}
.rt-btn .ti .i{width:16px;height:16px}
.rt-name{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:14.5px;font-weight:600;color:var(--wa-link);padding:6px 6px;border-radius:8px;min-height:36px;box-shadow:none}
.rt-name:hover{background:var(--wa-hover)}
.rt-name:focus{outline:0;background:var(--wa-soft);color:var(--wa-ink)}
.rt-name::placeholder{font-weight:400;color:var(--wa-sub)}
.rt-act{display:inline-flex;align-items:center;gap:3px;border:0;background:var(--wa-hover);color:var(--wa-sub);border-radius:99px;padding:0 8px 0 10px;min-height:30px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;flex:none;max-width:44%}
.rt-act span{overflow:hidden;text-overflow:ellipsis}
.rt-act:hover,.rt-act[aria-expanded="true"]{background:var(--wa-soft);color:var(--wa-ink)}
.rt-act.need{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.rt-act .i{width:13px;height:13px;flex:none}
.rt-go{display:inline-flex;align-items:center;gap:2px;border:0;background:var(--wa-link);color:#fff;border-radius:99px;padding:0 6px 0 10px;min-height:30px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;flex:none}
.rt-go:hover{filter:brightness(1.08)}
.rt-go .i{width:16px;height:16px}
.rt-add{display:flex;align-items:center;justify-content:center;gap:6px;border:1.5px dashed color-mix(in srgb,var(--wa-link) 55%,transparent);background:transparent;color:var(--wa-link);border-radius:10px;min-height:42px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px}
.rt-add:hover{background:var(--wa-soft)}
.rt-add:disabled{color:var(--wa-sub);border-color:var(--wa-sep);cursor:default;background:none}
.rt-add .i{width:18px;height:18px}
.rt-empty{align-self:stretch;background:var(--wa-in);color:var(--wa-sub);border-radius:0 0 10px 10px;padding:10px 12px;font-size:13px;text-align:center;box-shadow:0 1px .5px rgba(11,20,26,.13)}
.rt-hint{align-self:center;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--wa-sub);text-align:center;margin-top:6px;background:var(--wa-in);border-radius:8px;padding:3px 10px;box-shadow:0 1px .5px rgba(11,20,26,.1)}
.rt-hint .i{width:13px;height:13px}
.rt-under{font-size:12.5px;color:var(--muted);padding:0 6px}
.rt-under code{background:var(--soft2);border-radius:6px;padding:0 5px;font-family:inherit;color:var(--fg)}
.rt-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rt-foot .sp{flex:1}
.rt-dirty{display:none;align-items:center;gap:6px;font-size:13px;color:var(--warn);font-weight:600}
.rt-dirty::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.rt.dirty .rt-dirty{display:inline-flex}
/* كل الردود */
.rt-map{border:1px solid var(--line);border-radius:18px;background:var(--card);padding:4px 12px 8px;min-width:0}
.rt-map summary{cursor:pointer;font-family:var(--display);font-weight:800;font-size:15px;padding:8px 0;list-style:none;display:flex;align-items:center;gap:8px}
.rt-map summary::-webkit-details-marker{display:none}
.rt-map summary .i{width:17px;height:17px;color:var(--accent)}
.rt-map summary span{font-weight:400;color:var(--muted);font-size:12.5px}
.rt-map[open] summary{border-bottom:1px solid var(--line);margin-bottom:6px}
.rt-tree,.rt-tree ul{list-style:none;margin:0;padding:0}
.rt-tree ul{padding-inline-start:34px}
.rt-tree li{position:relative}
.rt-tree ul>li::before{content:"";position:absolute;inset-inline-start:-13px;top:0;bottom:0;border-inline-start:1.5px solid var(--line)}
.rt-tree ul>li:last-child::before{bottom:auto;height:18px}
.rt-tree ul>li::after{content:"";position:absolute;inset-inline-start:-13px;top:18px;width:10px;border-top:1.5px solid var(--line)}
.rt-node{display:inline-flex;align-items:center;gap:7px;min-height:36px;max-width:100%;border:0;background:none;border-radius:10px;padding:2px 8px 2px 8px;font:inherit;color:var(--fg);text-align:start}
.rt-node .ti{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;flex:none;background:var(--soft2);color:var(--muted)}
.rt-node .ti .i{width:14px;height:14px}
.rt-node .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.rt-node small{color:var(--muted);font-size:11.5px;white-space:nowrap}
button.rt-node{cursor:pointer}
button.rt-node .ti{background:var(--soft);color:var(--accent)}
button.rt-node .t{font-weight:700}
button.rt-node:hover{background:var(--soft2)}
button.rt-node.on{background:var(--soft);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 45%,transparent)}
button.rt-node.on .ti{background:var(--accent);color:var(--accent-ink)}
/* «وش يسوي الزر» */
.rt-pop{position:absolute;z-index:40;background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 40px -16px rgba(30,20,80,.35);padding:10px;width:340px;max-height:min(520px,80vh);overflow:auto}
.rt-pop.sheet{position:fixed;inset:auto 0 0 0;width:auto;border-radius:22px 22px 0 0;padding:10px 14px calc(16px + env(safe-area-inset-bottom));max-height:82vh}
.rt-pop .h{display:flex;align-items:center;gap:8px;padding:2px 2px 10px}
.rt-pop .h b{flex:1;font-family:var(--display);font-size:15px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-pop .h .ib{width:32px;height:32px}
.rt-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.rt-card{border:1.5px solid var(--line);background:var(--card);border-radius:14px;padding:10px 6px 8px;display:grid;gap:3px;justify-items:center;text-align:center;font:inherit;color:var(--fg);cursor:pointer;min-width:0}
.rt-card .ti{width:36px;height:36px;border-radius:11px;background:var(--soft2);display:grid;place-items:center;color:var(--accent)}
.rt-card .ti .i{width:18px;height:18px}
.rt-card b{font-size:13px;font-weight:700;line-height:1.3}
.rt-card small{font-size:11px;color:var(--muted);line-height:1.35}
.rt-card:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}
.rt-card.on{border-color:var(--accent);background:var(--soft)}
.rt-card.on .ti{background:var(--accent);color:var(--accent-ink)}
.rt-more{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;border:0;background:none;color:var(--accent);font:inherit;font-size:13px;font-weight:700;padding:9px 0 4px;cursor:pointer}
.rt-more .i{width:15px;height:15px}
.rt-more[aria-expanded="true"] .i{transform:rotate(180deg)}
.rt-svc{display:grid;gap:6px;margin-top:8px;padding:10px;background:var(--soft2);border-radius:12px}
.rt-svc b{font-size:13.5px}
.rt-svc select{width:100%}
.rt-pop .f{display:flex;gap:6px;border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.rt-pop .f button{flex:1;border:1.5px solid var(--line);background:none;border-radius:11px;min-height:36px;padding:0 6px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--fg);display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
.rt-pop .f button .i{width:14px;height:14px}
.rt-pop .f button:hover{background:var(--soft2)}
.rt-pop .f button:disabled{opacity:.35;cursor:default;background:none}
.rt-pop .f button.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 40%,var(--line))}
.rt-veil{position:fixed;inset:0;z-index:39;background:rgba(10,10,30,.3)}
@media (max-width:560px){.rt-phone{border-radius:24px;padding:6px}.rt-wrap{border-radius:18px}.rt-act{max-width:40%}.rt-grid{gap:6px}}`;
    document.head.appendChild(s);
  }

  let closeDoc = null;
  function mount(el, o) {
    style();
    const D = o.draft, en = o.lang === 'en';
    if (!Array.isArray(D.path)) D.path = [];
    const svcs = (o.services || []).filter((s) => s.active !== false);
    const svcOf = (x) => svcs.find((s) => 'svc:' + s.id === x.go);
    const now = new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
    const dirty = () => { D.dirty = true; const m = el.querySelector('.rt'); if (m) m.classList.add('dirty'); };
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
    const badge = (x) => { const k = kindOf(x); if (k === 'svc') return svcOf(x) ? 'يحجز ' + svcOf(x).name : 'اختر الخدمة'; return ACT[k][1]; };
    const go = (path) => { D.path = path; closePop(); paint(); };

    function row(x, i) {
      const k = kindOf(x), a = ACT[k], lbl = en ? (x.t_en || '') : (x.t || '');
      const ph = en ? (x.t || defLabel(k, svcOf(x)) || 'Button name') : (defLabel(k, svcOf(x)) || 'اسم الزر');
      const c = (x.opts || []).length;
      return `<div class="rt-btn" data-i="${i}"><span class="ti">${ic(a[5])}</span>
        <input class="rt-name" data-name="${i}" value="${esc(lbl)}" maxlength="20" placeholder="${esc(ph)}" aria-label="اسم الزر ${i + 1}" ${en ? 'dir="ltr"' : ''}>
        <button type="button" class="rt-act ${k === 'svc' && !svcOf(x) ? 'need' : ''}" data-act="${i}" aria-haspopup="dialog" aria-expanded="false" title="وش يسوي هالزر"><span>${esc(badge(x))}</span>${ic('down')}</button>
        ${k === 'msg' ? `<button type="button" class="rt-go" data-open="${i}" title="افتح رسالته">${c ? c : 'افتح'}${ic('chev')}</button>` : ''}</div>`;
    }

    function paint() {
      const { node, opts, nodes } = at();
      const txt = node ? (en ? (node.text_en || '') : (node.text || '')) : (D.welcome[en ? 'en' : 'ar'] || D.def[en ? 'en' : 'ar']);
      const crumbs = node ? `<nav class="rt-crumbs" aria-label="وين أنت"><button type="button" data-p="-1">أول رسالة</button>${nodes.map((n, i) => `<i>›</i><button type="button" data-p="${i}" class="${i === nodes.length - 1 ? 'on' : ''}">${esc(labelOf(n) || 'بدون اسم')}</button>`).join('')}</nav>` : '';
      el.innerHTML = `<div class="rt ${D.dirty ? 'dirty' : ''}">
        <div class="rt-main">
          <div class="rt-phone"><div class="rt-wrap">
            <div class="rt-head">${node ? `<button type="button" class="rt-back" data-p="${nodes.length - 2}" aria-label="رجوع">${ic('chev')}</button>` : ''}<span class="rt-av">${o.logo ? `<img src="${esc(o.logo)}" alt="">` : esc((o.bizName || 'م').trim().charAt(0))}</span><div style="min-width:0"><b>${esc(o.bizName || '')}</b><small>${node ? `الرسالة لما يضغط «${esc(labelOf(node) || '…')}»` : 'أول رسالة يشوفها العميل'}</small></div></div>
            ${crumbs}
            <div class="rt-chat">
              <div class="rt-day">${en ? 'Today' : 'اليوم'}</div>
              <div class="rt-out"><p>${esc(node ? (labelOf(node) || '…') : (en ? 'Hi' : 'السلام عليكم'))}</p><time>${now}</time></div>
              <div class="rt-in"><span class="pen">${icon('edit')}</span><textarea id="rtText" rows="2" maxlength="1000" ${en ? 'dir="ltr"' : ''} placeholder="${esc(node ? (en ? 'Message' : 'اكتب الرسالة اللي تطلع له، مثل: اختر الخدمة 👇') : D.def[en ? 'en' : 'ar'])}" aria-label="نص الرسالة">${esc(txt)}</textarea><time>${now}</time></div>
              <div class="rt-list">${opts.length ? opts.map(row).join('') : `<div class="rt-empty">ما فيه أزرار تحت هالرسالة. أضف زر، ${node ? 'أو خلها رسالة بس' : 'أو جهّزها من خدماتك'}.</div>`}<button type="button" class="rt-add" id="rtAdd" ${opts.length >= MAXO ? 'disabled' : ''}>${icon('plus')}${opts.length >= MAXO ? 'وصلت 10 أزرار' : 'أضف زر'}</button></div>
              ${opts.length > 3 ? `<div class="rt-hint">${ic('list')}أكثر من 3 أزرار تطلع للعميل كقائمة «خيارات أكثر»</div>` : ''}
            </div>
          </div></div>
          ${node ? '' : `<div class="rt-under">اكتب <code>{biz}</code> ويطلع مكانها اسم محلك</div>`}
          <div class="rt-foot">${node ? '' : `<button class="btn sm ghost" type="button" id="rtStarter">${ic('wand')}جهّزها من خدماتي</button>`}<span class="sp"></span><span class="rt-dirty">تعديلات ما انحفظت</span><button class="btn" type="button" id="rtSave">${icon('check')}حفظ الردود</button></div>
        </div>
        <details class="rt-map" ${innerWidth > 900 ? 'open' : ''}><summary>${ic('list')}كل الردود<span id="rtCount"></span></summary><div class="rt-tree" id="rtTree"></div></details></div>`;
      bind(node, opts);
      side();
      autosize();
    }

    function autosize() { const t = el.querySelector('#rtText'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.max(46, t.scrollHeight) + 'px'; }

    // «كل الردود» تتحدث مع الكتابة بدون ما يضيع المؤشر
    function side() {
      const li = (arr, path) => arr.map((x) => {
        const k = kindOf(x), t = esc(shown(x));
        if (k === 'msg') { const p = [...path, x.id], on = p.join('/') === D.path.join('/'), c = (x.opts || []).length; return `<li><button type="button" class="rt-node ${on ? 'on' : ''}" data-go="${p.join('/')}"><span class="ti">${ic('chat')}</span><span class="t">${t}</span><small>${c ? nOpts(c) : 'رسالة بس'}</small></button>${c ? `<ul>${li(x.opts, p)}</ul>` : ''}</li>`; }
        const what = badge(x);
        return `<li><span class="rt-node"><span class="ti">${ic(ACT[k][5])}</span><span class="t">${t}</span>${what !== shown(x) ? `<small>${esc(what)}</small>` : ''}</span></li>`;
      }).join('');
      const tree = el.querySelector('#rtTree'); if (!tree) return;
      tree.innerHTML = `<ul><li><button type="button" class="rt-node ${D.path.length ? '' : 'on'}" data-go=""><span class="ti">${ic('chat')}</span><span class="t">أول رسالة</span><small>${D.tree.length ? nOpts(D.tree.length) : 'بدون أزرار'}</small></button>${D.tree.length ? `<ul>${li(D.tree, [])}</ul>` : ''}</li></ul>`;
      el.querySelector('#rtCount').textContent = (count(D.tree) + 1) + ' رسائل';
      tree.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go ? b.dataset.go.split('/') : []));
    }

    // «وش يسوي الزر»: نافذة صغيرة جنب الزر بالكمبيوتر، ومن تحت بالجوال
    let pop = null, veil = null, popBtn = null;
    function closePop() {
      if (pop) pop.remove(); if (veil) veil.remove(); pop = veil = null;
      if (popBtn) { popBtn.setAttribute('aria-expanded', 'false'); popBtn = null; }
    }
    function place(btn) {
      const root = el.querySelector('.rt'), r = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const left = Math.max(0, Math.min(rr.width - pop.offsetWidth, r.right - rr.left - pop.offsetWidth));
      pop.style.left = left + 'px';
      const below = r.bottom - rr.top + 6, room = innerHeight - r.bottom;
      pop.style.top = (room < pop.offsetHeight + 16 && r.top > pop.offsetHeight + 16 ? r.top - rr.top - pop.offsetHeight - 6 : below) + 'px';
    }
    function openSheet(btn, opts, i) {
      const again = popBtn === btn; closePop(); if (again) return;
      const x = opts[i], cur = kindOf(x), small = innerWidth <= 560;
      let more = MORE.includes(cur), svcMode = cur === 'svc';
      const card = (k) => `<button type="button" class="rt-card ${k === cur ? 'on' : ''}" data-v="${k}"${k === 'svc' && !svcs.length ? ' disabled' : ''}><span class="ti">${ic(ACT[k][5])}</span><b>${esc(ACT[k][1])}</b><small>${esc(ACT[k][2])}</small></button>`;
      pop = document.createElement('div'); pop.className = 'rt-pop' + (small ? ' sheet' : ''); pop.setAttribute('role', 'dialog');
      const render = () => {
        pop.innerHTML = `<div class="h"><b>وش يسوي زر «${esc(shown(x))}»؟</b><button type="button" class="ib" data-x aria-label="إغلاق">${icon('x')}</button></div>
          <div class="rt-grid">${MAIN.map(card).join('')}</div>
          <button type="button" class="rt-more" data-more aria-expanded="${more}">${more ? 'خيارات أقل' : 'خيارات أكثر'}${ic('down')}</button>
          ${more ? `<div class="rt-grid">${MORE.map(card).join('')}</div>` : ''}
          ${svcMode ? `<div class="rt-svc"><b>أي خدمة يحجز؟</b><select data-svc aria-label="الخدمة"><option value="">اختر الخدمة</option>${svcs.map((s) => `<option value="${s.id}" ${'svc:' + s.id === x.go ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
          <div class="f"><button type="button" data-v="up" ${i ? '' : 'disabled'}>${ic('up')}فوق</button><button type="button" data-v="down" ${i < opts.length - 1 ? '' : 'disabled'}>${ic('down')}تحت</button><button type="button" data-v="dup" ${opts.length < MAXO ? '' : 'disabled'}>${ic('dup')}نسخة</button><button type="button" class="bad" data-v="del">${icon('trash')}احذف</button></div>`;
        pop.querySelector('[data-x]').onclick = closePop;
        pop.querySelector('[data-more]').onclick = () => { more = !more; render(); };
        const sel = pop.querySelector('[data-svc]');
        if (sel) { sel.onchange = () => { const sv = svcs.find((y) => y.id === sel.value); if (!sv) return; const prev = svcOf(x); if (!x.t || (prev && x.t === prev.name.slice(0, 20)) || x.t === defLabel(cur, prev)) { x.t = sv.name.slice(0, 20); x.t_en = (sv.name_en || '').slice(0, 20); } x.go = 'svc:' + sv.id; dirty(); closePop(); paint(); }; if (svcMode && !svcOf(x)) sel.focus(); }
        pop.querySelectorAll('.rt-card[data-v]').forEach((b) => b.onclick = () => pick(b.dataset.v));
        pop.querySelectorAll('.f [data-v]').forEach((b) => b.onclick = () => act(b.dataset.v));
        if (!small) place(btn);
      };
      const pick = (k) => {
        if (k === 'svc') { svcMode = true; more = true; render(); return; }
        if (k !== cur) {
          const wasDef = !x.t || x.t === defLabel(cur, svcOf(x));
          x.go = k;
          if (k === 'msg') { x.opts = Array.isArray(x.opts) && x.opts.length ? x.opts : [backBtn()]; x.text = x.text || ''; }
          else if (wasDef) { x.t = ACT[k][3]; x.t_en = ACT[k][4]; }
          dirty();
        }
        closePop();
        if (k === 'msg') { go([...D.path, x.id]); const t = el.querySelector('#rtText'); if (t && !t.value) t.focus(); }
        else paint();
      };
      const act = (v) => {
        if (v === 'up' && i) [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]];
        else if (v === 'down' && i < opts.length - 1) [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]];
        else if (v === 'dup' && opts.length < MAXO) opts.splice(i + 1, 0, clone(x));
        else if (v === 'del') {
          if (x.go === 'msg' && ((x.opts || []).some((y) => y.go !== 'back') || (x.text || '').trim()) && !confirm(`حذف زر «${shown(x)}» ورسالته وكل اللي تحته؟`)) return;
          opts.splice(i, 1);
        } else return;
        dirty(); closePop(); paint();
      };
      if (small) { veil = document.createElement('div'); veil.className = 'rt-veil'; veil.onclick = closePop; document.body.append(veil, pop); }
      else el.querySelector('.rt').appendChild(pop);
      popBtn = btn; btn.setAttribute('aria-expanded', 'true');
      render();
      const first = pop.querySelector('.rt-card.on') || pop.querySelector('.rt-card'); if (first && !svcMode) first.focus();
    }
    if (closeDoc) document.removeEventListener('mousedown', closeDoc, true);
    closeDoc = (e) => { if (pop && !pop.contains(e.target) && e.target !== popBtn && !(popBtn && popBtn.contains(e.target))) closePop(); };
    document.addEventListener('mousedown', closeDoc, true);
    el.onkeydown = (e) => { if (e.key === 'Escape' && pop) { const b = popBtn; closePop(); if (b) b.focus(); } };

    function bind(node, opts) {
      el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => go(D.path.slice(0, +b.dataset.p + 1)));
      const ta = el.querySelector('#rtText');
      ta.oninput = () => { if (node) node[en ? 'text_en' : 'text'] = ta.value; else D.welcome[en ? 'en' : 'ar'] = ta.value; dirty(); autosize(); };
      el.querySelectorAll('[data-name]').forEach((inp) => inp.oninput = () => { opts[+inp.dataset.name][en ? 't_en' : 't'] = inp.value; inp.closest('.rt-btn').classList.remove('err'); dirty(); side(); });
      el.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => openSheet(b, opts, +b.dataset.act));
      el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { go([...D.path, opts[+b.dataset.open].id]); const t = el.querySelector('#rtText'); if (t && !t.value) t.focus(); });
      el.querySelector('#rtAdd').onclick = () => {
        if (opts.length >= MAXO) return;
        opts.push({ id: newId(), t: '', go: 'msg', text: '', opts: [backBtn()] }); dirty(); paint();
        const ins = el.querySelectorAll('[data-name]'); if (ins.length) ins[ins.length - 1].focus();
      };
      const st = el.querySelector('#rtStarter');
      if (st) st.onclick = () => { if (D.tree.length && !confirm('تبدّل الأزرار الحالية بردود جاهزة من خدماتك وأسئلتك؟')) return; D.tree.splice(0, D.tree.length, ...starter(svcs, o.faq)); dirty(); go([]); };
      el.querySelector('#rtSave').onclick = async (e) => {
        const r = check(D.tree);
        if (r.err) {
          go(r.path); I.toast(r.err, true);
          if (r.field.text) el.querySelector('#rtText').focus();
          else if (r.field.o != null) { const b = el.querySelector(`.rt-btn[data-i="${r.field.o}"]`); if (b) { b.classList.add('err'); (r.field.act ? b.querySelector('[data-act]') : b.querySelector('input')).focus(); } }
          return;
        }
        e.currentTarget.disabled = true;
        try { if (await o.onSave(r.tree) !== false) { D.dirty = false; const m = el.querySelector('.rt'); if (m) m.classList.remove('dirty'); } }
        finally { const b = el.querySelector('#rtSave'); if (b) b.disabled = false; }
      };
    }
    paint();
  }

  window.MenuTree = { mount, fromMain, starter, check, count };
})();
