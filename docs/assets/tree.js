// شجرة الردود: رسالة فوقها خيارات، وكل خيار يا إجراء (احجز، الأسعار، خدمة معيّنة…) يا رسالة جديدة فوقها خياراتها، لأي عمق.
// MenuTree.mount(el, { draft, lang, bizName, services, onSave }) · draft = { tree: [...], welcome: {ar, en}, def: {ar, en}, path: [] }
// العقدة: { id, t, t_en, go, text, text_en, opts } · go: msg أو إجراء (نفس اللي يفهمه الرد الآلي في _shared/bot.ts)
(function () {
  const I = window.IHJ, { esc, icon } = I;
  const ACTS = [
    ['msg', 'يفتح رسالة جديدة بخياراتها', '', ''],
    ['book', 'يبدأ الحجز', 'احجز من هنا', 'Book now'],
    ['svc', 'يحجز خدمة معيّنة', '', ''],
    ['prices', 'يرسل الأسعار', 'الأسعار', 'Prices'],
    ['services', 'يرسل الخدمات', 'الخدمات', 'Services'],
    ['location', 'يرسل موقعكم', 'موقعنا', 'Location'],
    ['hours', 'يرسل الدوام', 'الدوام', 'Hours'],
    ['pay', 'يرسل طريقة الدفع', 'طريقة الدفع', 'Payment'],
    ['orders', 'يعرض طلباته', 'طلباتي', 'My orders'],
    ['packages', 'يعرض البكجات', 'البكجات', 'Packages'],
    ['balance', 'يعرض رصيده', 'رصيدي', 'My balance'],
    ['contact', 'يحوّله لكم', 'تواصل معنا', 'Contact us'],
    ['lang', 'يغيّر اللغة', 'English', 'عربي'],
    ['back', 'يرجع للرسالة اللي قبل', 'رجوع', 'Back'],
    ['home', 'يرجع لأول رسالة', 'القائمة', 'Menu'],
  ];
  const ACT = Object.fromEntries(ACTS.map((a) => [a[0], a]));
  const WHAT = { book: 'هنا يبدأ الحجز: يختار الخدمة واليوم والوقت', prices: 'يرد بالأسعار من خدماتك', services: 'يرد بقائمة خدماتك', location: 'يرد بموقعكم أو المدن اللي تغطونها', hours: 'يرد بأوقات الدوام', pay: 'يرد بطريقة الدفع', orders: 'يعرض طلباته ويقدر يغيّر الموعد أو يلغي', packages: 'يعرض البكجات ويقدر يشتري', balance: 'يعرض رصيده من البكجات', contact: 'تجيك محادثته في لوحتك وترد عليه بنفسك', lang: 'يحوّل الردود للغة الثانية' };
  const MAXO = 10;
  const newId = () => (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, '').padEnd(8, 'x');
  const kindOf = (o) => (o.go || '').startsWith('svc:') ? 'svc' : (o.go || 'msg');

  // من الأزرار القديمة (menu.main) لأول شجرة
  function fromMain(main, faq) {
    const keys = Array.isArray(main) && main.length ? main : ['book', 'orders', 'lang'];
    const out = [];
    for (const k of keys) {
      const f = /^faq:(\d+)$/.exec(k);
      if (f) { const e = (faq || [])[+f[1]]; if (e && e.a) out.push({ id: newId(), t: String(e.chip || e.q || 'سؤال').slice(0, 20), go: 'msg', text: e.a, opts: [] }); continue; }
      if (ACT[k]) out.push({ id: newId(), t: ACT[k][2], t_en: ACT[k][3], go: k });
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

  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const s = document.createElement('style');
    s.textContent = `
.mt{display:grid;gap:16px;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:start}
@media (max-width:880px){.mt{grid-template-columns:minmax(0,1fr)}}
.mt-main,.mt-side{display:grid;gap:12px;min-width:0}
.mt-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13.5px}
.mt-crumbs button{border:0;background:var(--soft2);color:var(--fg);border-radius:99px;padding:4px 11px;font:inherit;cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-crumbs button.on{background:var(--accent);color:var(--accent-ink);font-weight:700}
.mt-crumbs i{color:var(--muted);font-style:normal}
.mt-lbl{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-weight:700;font-size:14px}
.mt-lbl span{font-weight:400;color:var(--muted);font-size:12.5px}
.mt textarea{width:100%;min-height:76px}
.mt-opts{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.mt-opt{border:1.5px solid var(--line);background:var(--card);border-radius:14px;padding:9px;display:grid;gap:7px;grid-template-columns:auto minmax(0,1fr) auto;align-items:center}
.mt-opt.err{border-color:var(--bad)}
.mt-opt .n{width:24px;height:24px;border-radius:50%;background:var(--soft);color:var(--accent);display:grid;place-items:center;font-weight:800;font-size:12.5px}
.mt-opt input,.mt-opt select{min-width:0;width:100%}
.mt-opt .row2{grid-column:2/4;display:grid;gap:7px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.mt-opt .row2.one{grid-template-columns:minmax(0,1fr)}
.mt-tools{display:flex;gap:2px}
.mt-tools .ib{width:32px;height:32px}
.mt-open{border:1.5px dashed color-mix(in srgb,var(--accent) 45%,var(--line));background:var(--soft);color:var(--fg);border-radius:11px;padding:7px 10px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;gap:6px;align-items:center;justify-content:space-between;min-width:0}
.mt-open span{color:var(--muted);font-weight:400;white-space:nowrap}
.mt-add{justify-self:start}
.mt-phone{background:var(--soft2);border:1px solid var(--line);border-radius:18px;padding:12px;display:grid;gap:6px;min-height:150px;align-content:start}
.mt-phone .cap{font-size:12.5px;color:var(--muted);display:flex;justify-content:space-between;gap:8px}
.mt-phone .b{background:var(--card);border:1px solid var(--line);border-radius:12px 12px 12px 4px;padding:8px 10px;white-space:pre-wrap;font-size:14px;line-height:1.6;max-width:92%}
.mt-phone .bt{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px;text-align:center;color:var(--info);font-weight:600;font-size:14px;cursor:pointer;max-width:92%;font-family:inherit;width:100%}
.mt-phone .bt:hover{background:var(--soft)}
.mt-phone .lst{background:var(--card);border:1px solid var(--line);border-radius:12px;max-width:92%;overflow:hidden}
.mt-phone .lst .hd{padding:7px 10px;text-align:center;color:var(--info);font-weight:600;font-size:14px;border-bottom:1px solid var(--line)}
.mt-phone .lst button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;border-bottom:1px solid var(--line);background:none;padding:8px 10px;font:inherit;font-size:14px;color:var(--fg);cursor:pointer;text-align:start}
.mt-phone .lst button:last-child{border-bottom:0}
.mt-phone .lst button:hover{background:var(--soft)}
.mt-phone .lst button i{width:15px;height:15px;border:1.5px solid var(--muted);border-radius:50%;flex:none;margin-top:3px}
.mt-phone .note{justify-self:center;background:color-mix(in srgb,var(--gold) 22%,var(--card));border-radius:9px;padding:5px 10px;font-size:12.5px;text-align:center}
.mt-map{border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:grid;gap:4px;font-size:13.5px;max-height:340px;overflow:auto}
.mt-map .h{display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:14px;margin-bottom:4px}
.mt-map .h span{font-weight:400;color:var(--muted);font-size:12.5px}
.mt-map ul{list-style:none;margin:0;padding:0 14px 0 0;border-right:1.5px solid var(--line);display:grid;gap:2px}
.mt-map>ul{border-right:0;padding:0}
.mt-map li>div{display:flex;gap:6px;align-items:center;min-width:0}
.mt-map .lk{border:0;background:none;padding:2px 4px;border-radius:7px;font:inherit;color:var(--accent);font-weight:600;cursor:pointer;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.mt-map .lk.on{background:var(--soft)}
.mt-map .ac{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-map .ac b{color:var(--fg);font-weight:500}`;
    document.head.appendChild(s);
  }

  function mount(el, o) {
    style();
    const D = o.draft, en = o.lang === 'en';
    if (!Array.isArray(D.path)) D.path = [];
    const svcs = (o.services || []).filter((s) => s.active !== false);
    let note = '';
    // الرسالة الحالية من المسار (لو انحذفت وحدة منه نرجع لأقرب موجودة)
    function at() {
      let arr = D.tree, node = null; const ok = [];
      for (const id of D.path) { const n = arr.find((x) => x.id === id && x.go === 'msg'); if (!n) break; ok.push(id); node = n; n.opts = n.opts || []; arr = n.opts; }
      D.path = ok;
      return { node, opts: arr };
    }
    const labelOf = (x) => (en ? (x.t_en || x.t) : (x.t || x.t_en)) || '';
    const defLabel = (k, svc) => k === 'svc' ? (svc ? (en ? (svc.name_en || svc.name) : svc.name) : '') : (ACT[k] ? ACT[k][en ? 3 : 2] : '');
    const msgText = (n) => n ? (en ? (n.text_en || n.text) : (n.text || n.text_en)) || '' : (D.welcome[en ? 'en' : 'ar'] || D.def[en ? 'en' : 'ar']);
    const fill = (t) => String(t || '').replace(/\{biz\}/g, o.bizName || '');

    function paint() {
      const { node, opts } = at();
      // المسار
      const crumbs = [`<button type="button" data-p="-1" class="${node ? '' : 'on'}">أول رسالة</button>`];
      let arr = D.tree;
      D.path.forEach((id, i) => { const n = arr.find((x) => x.id === id); arr = n.opts; crumbs.push(`<i>›</i><button type="button" data-p="${i}" class="${i === D.path.length - 1 ? 'on' : ''}">${esc(labelOf(n) || 'بدون اسم')}</button>`); });
      const kinds = ACTS.filter((a) => a[0] !== 'svc' || svcs.length);
      const optHtml = opts.map((x, i) => {
        const k = kindOf(x), lbl = en ? (x.t_en || '') : (x.t || '');
        const ph = en ? (x.t || defLabel(k) || 'Button name') : (defLabel(k) || 'اسم الزر');
        const sel = `<select data-o="${i}" data-k="go" aria-label="وش يسوي الزر">${kinds.map((a) => `<option value="${a[0]}" ${a[0] === k ? 'selected' : ''}>${esc(a[1])}</option>`).join('')}</select>`;
        let second = '';
        if (k === 'msg') { const c = (x.opts || []).length; second = `<button type="button" class="mt-open" data-open="${i}">${esc(msgText(x) ? 'رسالته وخياراته' : 'اكتب رسالته وخياراته')}<span>${c ? (c === 1 ? 'خيار واحد' : c === 2 ? 'خياران' : c + ' خيارات') + ' ←' : 'فاضي ←'}</span></button>`; }
        else if (k === 'svc') { const cur = x.go.slice(4); second = `<select data-o="${i}" data-k="svc" aria-label="الخدمة"><option value="">اختر الخدمة</option>${svcs.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`; }
        return `<li class="mt-opt" data-i="${i}"><span class="n">${i + 1}</span><input data-o="${i}" data-k="t" value="${esc(lbl)}" maxlength="20" placeholder="${esc(ph)}" aria-label="اسم الزر ${i + 1}" ${en ? 'dir="ltr"' : ''}>
          <span class="mt-tools"><button class="ib" type="button" data-up="${i}" aria-label="فوق" ${i ? '' : 'disabled'}>${upIco}</button><button class="ib" type="button" data-down="${i}" aria-label="تحت" ${i < opts.length - 1 ? '' : 'disabled'}>${downIco}</button><button class="ib" type="button" data-del="${i}" aria-label="حذف">${icon('trash')}</button></span>
          <div class="row2 ${second ? '' : 'one'}">${sel}${second}</div></li>`;
      }).join('');
      el.innerHTML = `<div class="mt">
        <div class="mt-main">
          <nav class="mt-crumbs" aria-label="وين أنت في الشجرة">${crumbs.join('')}</nav>
          <label class="mt-lbl" for="mtText">${node ? `الرسالة اللي تطلع لما يضغط «${esc(labelOf(node))}»` : 'أول رسالة (الترحيب)'}<span>تطلع فوق الخيارات${node ? '' : '، و{biz} يصير اسم المحل'}</span></label>
          <textarea id="mtText" rows="3" maxlength="1000" ${en ? 'dir="ltr"' : ''} placeholder="${esc(node ? (en ? (node.text || 'Message') : 'مثل: اختر الخدمة 👇') : D.def[en ? 'en' : 'ar'])}">${esc(node ? (en ? (node.text_en || '') : (node.text || '')) : (D.welcome[en ? 'en' : 'ar'] || D.def[en ? 'en' : 'ar']))}</textarea>
          <div class="mt-lbl">الخيارات تحتها<span>${opts.length} من ${MAXO} · 3 أو أقل تطلع أزرار، وأكثر تطلع قائمة</span></div>
          <ol class="mt-opts">${optHtml || '<li class="tiny">ما فيه خيارات، يعني يرد بالرسالة وتحتها أزرار «تحت كل جواب»</li>'}</ol>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm ghost mt-add" type="button" id="mtAdd" ${opts.length >= MAXO ? 'disabled' : ''}>${icon('plus')}خيار</button>${node ? '' : `<button class="btn sm ghost" type="button" id="mtStarter">${icon('refresh')}جهّزها من خدماتي</button>`}<span class="sp"></span><button class="btn sm" type="button" id="mtSave">${icon('check')}حفظ الردود</button></div>
        </div>
        <div class="mt-side">
          <div class="mt-phone" id="mtPhone"></div>
          <div class="mt-map" id="mtMap"></div>
        </div></div>`;
      bind(node, opts);
      side();
    }

    // الجوال والخريطة يتحدثون مع الكتابة بدون ما يضيع المؤشر
    function side() {
      const { node, opts } = at();
      const rows = opts.map((x) => ({ x, t: labelOf(x) || defLabel(kindOf(x), svcs.find((s) => 'svc:' + s.id === x.go)) || '…' }));
      const body = fill(msgText(node)) || '…';
      let h = `<div class="cap"><span>كذا يشوفها العميل</span><span>اضغط الأزرار</span></div><div class="b">${esc(body)}</div>`;
      if (rows.length && rows.length <= 3) h += rows.map((r, i) => `<button type="button" class="bt" data-tap="${i}">${esc(r.t)}</button>`).join('');
      else if (rows.length) h += `<div class="lst"><div class="hd">☰ ${en ? 'More options' : 'خيارات أكثر'}</div>${rows.map((r, i) => `<button type="button" data-tap="${i}"><span>${esc(r.t)}</span><i></i></button>`).join('')}</div>`;
      if (note) h += `<div class="note">${esc(note)}</div>`;
      const ph = el.querySelector('#mtPhone'); ph.innerHTML = h;
      ph.querySelectorAll('[data-tap]').forEach((b) => b.onclick = () => {
        const x = rows[+b.dataset.tap].x, k = kindOf(x); note = '';
        if (k === 'msg') D.path = [...D.path, x.id];
        else if (k === 'back') D.path = D.path.slice(0, -1);
        else if (k === 'home') D.path = [];
        else if (k === 'svc') { const s = svcs.find((y) => 'svc:' + y.id === x.go); note = s ? `يبدأ حجز «${s.name}» على طول` : 'اختر الخدمة لهالزر'; return side(); }
        else { note = WHAT[k] || ''; return side(); }
        paint();
      });
      // الخريطة
      const li = (arr, path) => arr.map((x) => {
        const k = kindOf(x), t = esc(labelOf(x) || '…');
        if (k === 'msg') { const p = [...path, x.id], on = p.join('/') === D.path.join('/'); return `<li><div><button type="button" class="lk ${on ? 'on' : ''}" data-go="${p.join('/')}">💬 ${t}</button></div>${(x.opts || []).length ? `<ul>${li(x.opts, p)}</ul>` : ''}</li>`; }
        const what = k === 'svc' ? 'يحجز ' + ((svcs.find((s) => 'svc:' + s.id === x.go) || {}).name || '؟') : ACT[k][1];
        return `<li><div class="ac"><b>${t}</b> · ${esc(what)}</div></li>`;
      }).join('');
      const map = el.querySelector('#mtMap');
      map.innerHTML = `<div class="h">خريطة الردود<span>${count(D.tree) + 1} رسائل</span></div><ul><li><div><button type="button" class="lk ${D.path.length ? '' : 'on'}" data-go="">👋 أول رسالة</button></div><ul>${li(D.tree, [])}</ul></li></ul>`;
      map.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { D.path = b.dataset.go ? b.dataset.go.split('/') : []; note = ''; paint(); });
    }

    function bind(node, opts) {
      el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { D.path = D.path.slice(0, +b.dataset.p + 1); note = ''; paint(); });
      el.querySelector('#mtText').oninput = (e) => {
        const v = e.target.value;
        if (node) node[en ? 'text_en' : 'text'] = v; else D.welcome[en ? 'en' : 'ar'] = v;
        side();
      };
      el.querySelectorAll('[data-k="t"]').forEach((inp) => inp.oninput = () => { opts[+inp.dataset.o][en ? 't_en' : 't'] = inp.value; side(); });
      el.querySelectorAll('select[data-k="go"]').forEach((s) => s.onchange = () => {
        const x = opts[+s.dataset.o], old = kindOf(x), k = s.value;
        const wasDef = !x.t || x.t === defLabel(old, svcs.find((y) => 'svc:' + y.id === x.go));
        x.go = k === 'svc' ? 'svc:' : k;
        if (k === 'msg') { x.opts = x.opts || []; x.text = x.text || ''; }
        if (wasDef && k !== 'msg' && k !== 'svc') { x.t = ACT[k][2]; x.t_en = ACT[k][3]; }
        paint();
      });
      el.querySelectorAll('select[data-k="svc"]').forEach((s) => s.onchange = () => {
        const x = opts[+s.dataset.o], sv = svcs.find((y) => y.id === s.value);
        const prev = svcs.find((y) => 'svc:' + y.id === x.go);
        if (!x.t || (prev && x.t === prev.name.slice(0, 20))) { x.t = sv ? sv.name.slice(0, 20) : ''; x.t_en = sv && sv.name_en ? sv.name_en.slice(0, 20) : ''; }
        x.go = 'svc:' + (sv ? sv.id : ''); paint();
      });
      el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => { D.path = [...D.path, opts[+b.dataset.open].id]; note = ''; paint(); el.querySelector('#mtText').focus(); });
      el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { const i = +b.dataset.up; [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]]; paint(); });
      el.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => { const i = +b.dataset.down; [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]]; paint(); });
      el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.del, x = opts[i];
        if (x.go === 'msg' && ((x.opts || []).length || (x.text || '').trim()) && !confirm(`حذف «${labelOf(x) || 'الخيار'}» ورسالته وكل اللي تحته؟`)) return;
        opts.splice(i, 1); paint();
      });
      el.querySelector('#mtAdd').onclick = () => {
        if (opts.length >= MAXO) return;
        opts.push({ id: newId(), t: '', go: 'msg', text: '', opts: [] }); paint();
        const ins = el.querySelectorAll('[data-k="t"]'); if (ins.length) ins[ins.length - 1].focus();
      };
      const st = el.querySelector('#mtStarter');
      if (st) st.onclick = () => { if (D.tree.length && !confirm('تبدّل الخيارات الحالية بشجرة جاهزة من خدماتك وأسئلتك؟')) return; D.tree.splice(0, D.tree.length, ...starter(svcs, o.faq)); D.path = []; note = ''; paint(); };
      el.querySelector('#mtSave').onclick = async (e) => {
        const r = check(D.tree);
        if (r.err) {
          D.path = r.path; paint(); I.toast(r.err, true);
          if (r.field.text) el.querySelector('#mtText').focus();
          else if (r.field.o != null) { const li = el.querySelector(`.mt-opt[data-i="${r.field.o}"]`); if (li) { li.classList.add('err'); li.querySelector('input').focus(); } }
          return;
        }
        e.target.disabled = true;
        try { await o.onSave(r.tree); } finally { const b = el.querySelector('#mtSave'); if (b) b.disabled = false; }
      };
    }
    paint();
  }

  const upIco = `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>`;
  const downIco = `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

  window.MenuTree = { mount, fromMain, starter, check, count };
})();
