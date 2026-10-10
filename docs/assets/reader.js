// «عبّيها من صورة أو موقع»: نافذة تختار فيها صور قائمة الأسعار (أو PDF)، أو رابط موقعه، أو تلصق الأسعار كنص،
// وتنرسل للقراءة الذكية. I.reader يرجّع البيانات المقروءة، وI.review يعرضها للمراجعة (تختار وش ينحفظ)
// والصفحة نفسها تقرر وين تحفظ (لوحة المنشأة مباشرة، أو نموذج البيانات في لوحتي، أو خطوات النموذج للعميل).
(function () {
  const I = window.IHJ, { $, esc, icon } = I;

  // المدن المعروفة بمراكزها ونطاقها (نفس قائمة النموذج ولوحة المنشأة)، مع أسمائها بالإنجليزي
  const CITIES = [
    ['الرياض', 24.7136, 46.6753, 40, 'riyadh'], ['جدة', 21.4858, 39.1925, 35, 'jeddah jiddah'], ['مكة المكرمة', 21.3891, 39.8579, 25, 'makkah mecca مكه'], ['المدينة المنورة', 24.5247, 39.5692, 25, 'madinah medina المدينه'],
    ['الدمام', 26.4207, 50.0888, 20, 'dammam'], ['الخبر', 26.2794, 50.2083, 18, 'khobar alkhobar'], ['الظهران', 26.2886, 50.114, 9, 'dhahran'], ['القطيف', 26.5196, 50.0115, 12, 'qatif'],
    ['الجبيل', 27.0174, 49.6225, 20, 'jubail'], ['الأحساء', 25.3833, 49.5867, 30, 'ahsa hofuf alhasa الهفوف الاحساء'], ['الطائف', 21.2703, 40.4158, 25, 'taif'], ['تبوك', 28.3835, 36.5662, 20, 'tabuk'],
    ['أبها', 18.2164, 42.5053, 20, 'abha ابها'], ['خميس مشيط', 18.3, 42.7333, 20, 'khamis mushait'], ['حائل', 27.5114, 41.7208, 20, 'hail حايل'], ['بريدة', 26.326, 43.975, 20, 'buraydah buraidah'],
    ['عنيزة', 26.0842, 43.9937, 15, 'unaizah onaizah'], ['نجران', 17.4924, 44.1277, 20, 'najran'], ['جازان', 16.8892, 42.5511, 20, 'jazan jizan جيزان'], ['ينبع', 24.0895, 38.0618, 20, 'yanbu'],
    ['الخرج', 24.1556, 47.312, 20, 'kharj alkharj'], ['حفر الباطن', 28.4328, 45.9708, 20, 'hafar albatin hafr'],
  ];
  const nk = (s) => String(s || '').toLowerCase().replace(/[\sـ'-]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/^(al|ال)/, '');
  function cityPreset(name) {
    const k = nk(name); if (k.length < 2) return null;
    for (const c of CITIES) { const keys = [c[0], ...c[4].split(' ')].map(nk); if (keys.includes(k)) return { name: c[0], lat: c[1], lng: c[2], radius_km: c[3] }; }
    for (const c of CITIES) { const keys = [c[0], ...c[4].split(' ')].map(nk); if (keys.some((x) => x.length >= 3 && (k.includes(x) || x.includes(k)))) return { name: c[0], lat: c[1], lng: c[2], radius_km: c[3] }; }
    return null;
  }

  // الأوقات بكلام مفهوم: «الأحد إلى الخميس: 9 ص إلى 9 م»
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const t12 = (hm) => { const [h, m] = String(hm).split(':').map(Number); if (h === 0 && !m) return '12 الليل'; if (h === 12 && !m) return '12 الظهر'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'ص' : 'م'}`; };
  function hoursLines(hours) {
    const by = DAYS.map((_, d) => (hours || []).filter((h) => +h.weekday === d).map((h) => `${t12(h.open)} إلى ${t12(h.close)}`).join(' و'));
    const out = []; let i = 0;
    while (i < 7) { let j = i; while (j + 1 < 7 && by[j + 1] === by[i]) j++; out.push(`${i === j ? DAYS[i] : DAYS[i] + ' إلى ' + DAYS[j]}: ${by[i] || 'مغلق'}`); i = j + 1; }
    return out;
  }

  const ERR = {
    ai_off: 'القراءة الذكية مو مفعّلة بعد', busy: 'قراءات كثيرة اليوم، جرّب بعد شوي', unreadable: 'ما لقينا فيها خدمات أو أسعار واضحة. جرّب صورة أوضح وأقرب للقائمة',
    social: 'حسابات إنستقرام وتيك توك وسناب ما تنفتح لنا. صوّر الشاشة اللي فيها الأسعار وارفع الصورة', maps: 'هذا رابط موقع على الخريطة. حطه في خانة الفرع، وهنا ارفع صورة الأسعار',
    fetch: 'ما قدرنا نفتح الموقع. صوّر صفحة الأسعار وارفع الصورة', empty_page: 'الصفحة ما فيها نص نقدر نقراه. صوّر صفحة الأسعار وارفع الصورة', bad_url: 'الرابط غير صحيح',
    too_big: 'الملف كبير، اختر صورة أصغر', image: 'نوع الصورة غير مدعوم، جرّب لقطة شاشة', pdf: 'ملف PDF ما انفتح', empty: 'اختر صورة أو اكتب رابط أو الصق النص', ai_key: 'مفتاح القراءة الذكية غير صحيح',
    network: 'تعذّر الاتصال، تأكد من الإنترنت', invalid_link: 'الرابط غير صالح',
  };
  const STEPS = ['نقرأ المادة…', 'نطلّع الخدمات والأسعار…', 'نرتّب الأوقات والفروع…', 'نجهّز الأسئلة اللي تتكرر…', 'آخر لمسات…'];

  // الصورة تصغر لين 1600 بكسل (أوضح للقراءة وأخف بالرفع)
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(Object.assign(new Error('image'), { code: 'image' })); };
      img.src = url;
    });
  }
  const asDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(Object.assign(new Error('pdf'), { code: 'pdf' })); r.readAsDataURL(file); });

  // opts: { send(payload) → Promise<{data, sources}>, intro, adminHint }
  function reader(opts) {
    return new Promise((resolve) => {
      let imgs = [], pdf = null, busy = false, done = false, tick = null;
      const m = I.modal(`<div class="mh"><h3 class="grow">عبّيها من صورة أو موقع</h3><button class="ib" data-close aria-label="إغلاق">${icon('x')}</button></div>
        <div class="mb rd">
          <p class="tiny" style="margin:0">${esc(opts.intro || 'صورة قائمة الأسعار أو المنيو، أو رابط الموقع، أو الأسعار كنص. نقرأها ونعبّي الخدمات والأسعار والأوقات، وتراجعها قبل الحفظ.')}</p>
          <label class="rd-drop" id="rdDrop"><input type="file" id="rdFile" accept="image/*,application/pdf" multiple hidden>${icon('file')}<b>صوّر أو اختر صور</b><span class="tiny">لين 5 صور أو ملف PDF (4 ميقا)، وتقدر تلصق صورة هنا</span></label>
          <div class="rd-thumbs" id="rdThumbs" hidden></div>
          <label class="f"><span>أو رابط الموقع</span><input id="rdUrl" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://…"></label>
          <details class="rd-more"><summary>الأسعار مكتوبة كرسالة؟ الصقها هنا</summary><textarea id="rdText" rows="5" maxlength="20000" placeholder="قص شعر 40&#10;حلاقة ذقن 25"></textarea></details>
          <div class="rd-run" id="rdRun" hidden><div class="rd-bar"><i></i></div><b id="rdStep"></b><span class="tiny">تاخذ عادة بين 20 و40 ثانية</span></div>
          <div class="rd-err" id="rdErr" hidden></div>
        </div>
        <div class="mf"><button class="btn ghost" type="button" id="rdBack">رجوع</button><button class="btn" type="button" id="rdGo" disabled>${icon('check')}اقرأها</button></div>`);
      const finish = (v) => { if (done) return; done = true; clearInterval(tick); obs.disconnect(); document.removeEventListener('paste', onPaste); resolve(v); };
      // لو انقفلت النافذة (رجوع، Esc، برا النافذة) نرجّع لا شي
      const obs = new MutationObserver(() => { if (!m.classList.contains('on')) finish(null); });
      obs.observe(m, { attributes: true, attributeFilter: ['class'] });
      const ready = () => { $('rdGo').disabled = busy || !(imgs.length || pdf || $('rdUrl').value.trim() || $('rdText').value.trim()); };
      const err = (code) => { const el = $('rdErr'); el.innerHTML = esc(ERR[code] || 'ما ضبطت القراءة هالمرة، جرّب مرة ثانية') + (code === 'ai_off' && opts.adminHint ? ` · <a href="${esc(opts.adminHint)}">طريقة التفعيل</a>` : ''); el.hidden = false; };
      const paint = () => {
        const el = $('rdThumbs');
        el.hidden = !imgs.length && !pdf;
        el.innerHTML = imgs.map((s, i) => `<span class="th"><img src="${s}" alt=""><button type="button" class="ib" data-rm="${i}" aria-label="شيل الصورة">${icon('x')}</button></span>`).join('') + (pdf ? `<span class="th pdf">${icon('file')}<small>${esc(pdf.name)}</small><button type="button" class="ib" data-rp aria-label="شيل الملف">${icon('x')}</button></span>` : '');
        el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => { e.preventDefault(); imgs.splice(+b.dataset.rm, 1); paint(); });
        const rp = el.querySelector('[data-rp]'); if (rp) rp.onclick = (e) => { e.preventDefault(); pdf = null; paint(); };
        ready();
      };
      async function addFiles(list) {
        $('rdErr').hidden = true;
        for (const f of Array.from(list || [])) {
          try {
            if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { if (f.size > 4_000_000) throw Object.assign(new Error('too_big'), { code: 'too_big' }); pdf = { name: f.name, data: await asDataUrl(f) }; }
            else if (imgs.length < 5) imgs.push(await shrink(f));
          } catch (e) { err(e.code || 'image'); }
        }
        paint();
      }
      function onPaste(e) { if (busy) return; const files = Array.from((e.clipboardData || {}).files || []).filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addFiles(files); } }
      document.addEventListener('paste', onPaste);
      $('rdFile').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
      const drop = $('rdDrop');
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('on'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); addFiles(e.dataTransfer.files); });
      $('rdUrl').oninput = $('rdText').oninput = () => { $('rdErr').hidden = true; ready(); };
      $('rdBack').onclick = () => { I.closeAll(); finish(null); };
      $('rdGo').onclick = async () => {
        busy = true; ready(); $('rdErr').hidden = true; $('rdRun').hidden = false;
        let k = 0; $('rdStep').textContent = STEPS[0];
        tick = setInterval(() => { k = Math.min(k + 1, STEPS.length - 1); $('rdStep').textContent = STEPS[k]; }, 7000);
        try {
          const r = await opts.send({ images: imgs, pdf: pdf ? pdf.data : undefined, url: $('rdUrl').value.trim() || undefined, text: $('rdText').value.trim() || undefined });
          clearInterval(tick);
          if (done) return;
          if (!r || !r.data) throw Object.assign(new Error('unreadable'), { code: 'unreadable' });
          finish(r);
        } catch (e) {
          clearInterval(tick); busy = false; $('rdRun').hidden = true; ready();
          err(e.code || e.message);
        }
      };
      ready();
    });
  }

  // العدد بالعربي: «خدمة وحدة»، «خدمتين»، «3 خدمات»، «12 خدمة»
  const count = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : `${n} ${n <= 10 ? few : many}`;
  // ملخص قصير لما انقرأ: «12 خدمة · الأوقات · فرعين · 3 أسئلة»
  function summary(d) {
    const p = [];
    if (d.services.length) p.push(count(d.services.length, 'خدمة وحدة', 'خدمتين', 'خدمات', 'خدمة'));
    if (d.hours.length) p.push('الأوقات');
    if (d.branches.length) p.push(count(d.branches.length, 'فرع', 'فرعين', 'فروع', 'فرع'));
    else if (d.cities.length) p.push(count(d.cities.length, 'مدينة', 'مدينتين', 'مدن', 'مدينة'));
    if (d.faq.length) p.push(count(d.faq.length, 'سؤال', 'سؤالين', 'أسئلة', 'سؤال'));
    return p.join(' · ');
  }

  // المراجعة: كل شي مختار افتراضيًا ويتعدّل قبل الحفظ.
  // opts: { current: {services, hours, faq}, place, apply(sel) → Promise<string|void>, applyLabel, hideHours, hideFaq, hidePlaces }
  function review(data, opts) {
    const cur = opts.current || {}, place = opts.place || data.place_mode || 'visit';
    const key = (s) => nk(s);
    const curNames = new Set((cur.services || []).map((s) => key(s.name)));
    const svc = data.services.map((s) => ({ ...s, on: true }));
    const faq = (opts.hideFaq ? [] : data.faq).map((f) => ({ ...f, on: true }));
    const cities = place === 'visit' && !opts.hidePlaces ? data.cities.map((n) => ({ n, p: cityPreset(n) })).map((c) => ({ ...c, on: !!c.p })) : [];
    const branches = place === 'shop' && !opts.hidePlaces ? data.branches.map((b) => ({ ...b, on: true })) : [];
    let useHours = !opts.hideHours && data.hours.length > 0;
    const m = I.modal(`<div class="mh"><h3 class="grow">راجع اللي قريناه</h3><button class="ib" data-close aria-label="إغلاق">${icon('x')}</button></div>
      <div class="mb rv">
        <div class="rv-sum">${icon('check')}<span>${esc(summary(data) || 'ما لقينا شي')}${data.name ? ' · ' + esc(data.name) : ''}</span></div>
        ${svc.length ? `<section><div class="rv-h"><b>الخدمات والأسعار</b><label class="check small"><input type="checkbox" id="rvAll" checked>الكل</label></div>
          ${opts.note ? `<div class="hint">${esc(opts.note)}</div>` : ''}<div class="rv-svc" id="rvSvc"></div><p class="tiny">الاسم 24 حرف بالكثير لأنه يطلع في قائمة الواتساب. «يبدأ من» يخلي البوت يقول «يبدأ من 150 ريال».</p></section>` : ''}
        ${data.hours.length && !opts.hideHours ? `<section><div class="rv-h"><b>أوقات العمل</b><label class="check small"><input type="checkbox" id="rvHours" ${useHours ? 'checked' : ''}>${(cur.hours || []).length ? 'بدّل الأوقات الحالية' : 'احفظها'}</label></div>
          <div class="rv-hours">${hoursLines(data.hours).map((l) => `<div>${esc(l)}</div>`).join('')}</div>${(cur.hours || []).length ? `<p class="tiny">الحالية: ${esc(hoursLines(cur.hours).join(' · '))}</p>` : ''}</section>` : ''}
        ${cities.length ? `<section><div class="rv-h"><b>المدن اللي يغطيها</b></div><div class="chipz" id="rvCities">${cities.map((c, i) => `<label class="chip ${c.on ? 'on' : ''}"><input type="checkbox" data-c="${i}" ${c.on ? 'checked' : ''} ${c.p ? '' : 'disabled'} hidden>${esc(c.p ? c.p.name : c.n)}${c.p ? '' : ' (حددها بنفسك)'}</label>`).join('')}</div></section>` : ''}
        ${branches.length ? `<section><div class="rv-h"><b>الفروع</b></div>${branches.map((b, i) => `<label class="rv-row"><input type="checkbox" data-b="${i}" checked><span><b>${esc(b.name)}</b>${b.city ? ' · ' + esc(b.city) : ''}<br><span class="tiny">${esc(b.address || '')}${b.maps ? ' · فيه رابط موقع ✓' : ' · بدون رابط موقع، تحدده بعدين'}</span></span></label>`).join('')}</section>` : ''}
        ${faq.length ? `<section><div class="rv-h"><b>أسئلة يرد عليها البوت</b></div>${faq.map((f, i) => `<label class="rv-row"><input type="checkbox" data-f="${i}" checked><span><b>${esc(f.chip)}</b><br><span class="tiny">${esc(f.a)}</span></span></label>`).join('')}</section>` : ''}
        ${data.notes ? `<div class="hint">${esc(data.notes)}</div>` : ''}
        <div class="rd-err" id="rvErr" hidden></div>
      </div>
      <div class="mf"><button class="btn ghost" type="button" data-close>رجوع</button><button class="btn" type="button" id="rvGo">${icon('check')}${esc(opts.applyLabel || 'احفظ المختار')}</button></div>`);
    m.querySelector('.box').classList.add('wide');
    const paintSvc = () => {
      const el = $('rvSvc'); if (!el) return;
      el.innerHTML = svc.map((s, i) => `<div class="rv-s ${s.on ? '' : 'off'}"><input type="checkbox" data-si="${i}" ${s.on ? 'checked' : ''} aria-label="اختيار">
        <input data-sk="name" data-i="${i}" value="${esc(s.name)}" maxlength="24" aria-label="الخدمة">
        <input data-sk="price" data-i="${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${s.price ?? ''}" placeholder="بدون سعر" aria-label="السعر">
        <label class="from"><input type="checkbox" data-sk="price_from" data-i="${i}" ${s.price_from ? 'checked' : ''}>يبدأ من</label>
        <span class="tag ${curNames.has(key(s.name)) ? 'up' : ''}">${curNames.has(key(s.name)) ? 'موجودة' : 'جديدة'}</span></div>`).join('');
      el.querySelectorAll('[data-si]').forEach((x) => x.onchange = () => { svc[+x.dataset.si].on = x.checked; paintSvc(); });
      el.querySelectorAll('[data-sk]').forEach((x) => x.oninput = x.onchange = () => {
        const s = svc[+x.dataset.i], k = x.dataset.sk;
        if (k === 'price_from') s.price_from = x.checked; else if (k === 'price') s.price = x.value === '' ? null : Number(x.value); else s.name = x.value;
      });
    };
    paintSvc();
    if ($('rvAll')) $('rvAll').onchange = (e) => { svc.forEach((s) => { s.on = e.target.checked; }); paintSvc(); };
    if ($('rvHours')) $('rvHours').onchange = (e) => { useHours = e.target.checked; };
    m.querySelectorAll('[data-c]').forEach((x) => x.onchange = () => { cities[+x.dataset.c].on = x.checked; x.parentElement.classList.toggle('on', x.checked); });
    m.querySelectorAll('[data-b]').forEach((x) => x.onchange = () => { branches[+x.dataset.b].on = x.checked; });
    m.querySelectorAll('[data-f]').forEach((x) => x.onchange = () => { faq[+x.dataset.f].on = x.checked; });
    return new Promise((resolve) => {
      // رجوع أو إغلاق = ما انحفظ شي
      const obs = new MutationObserver(() => { if (!m.classList.contains('on')) { obs.disconnect(); resolve(null); } });
      obs.observe(m, { attributes: true, attributeFilter: ['class'] });
      $('rvGo').onclick = async (e) => {
        const sel = {
          services: svc.filter((s) => s.on && String(s.name).trim()).map((s) => ({ name: String(s.name).trim().slice(0, 24), name_en: s.name_en || '', price: s.price === '' || s.price == null || !isFinite(s.price) ? null : Number(s.price), price_from: !!s.price_from && s.price != null && s.price !== '', duration_min: s.duration_min || null })),
          hours: useHours ? data.hours : null,
          faq: faq.filter((f) => f.on).map((f) => ({ chip: f.chip, q: f.q, a: f.a })),
          cities: cities.filter((c) => c.on && c.p).map((c) => c.p),
          branches: branches.filter((b) => b.on),
          name: data.name, name_en: data.name_en, activity: data.activity, place_mode: data.place_mode, notes: data.notes,
        };
        if (!sel.services.length && !sel.hours && !sel.faq.length && !sel.cities.length && !sel.branches.length) { const el = $('rvErr'); el.textContent = 'ما اخترت شي'; el.hidden = false; return; }
        e.target.disabled = true;
        try { const msg = await opts.apply(sel); obs.disconnect(); I.closeAll(); I.toast(msg || 'انحفظ ✓'); resolve(sel); }
        catch (x) { const el = $('rvErr'); el.textContent = (x && (ERR[x.code] || I.errText(x))) || 'ما انحفظ'; el.hidden = false; e.target.disabled = false; }
      };
    });
  }

  Object.assign(I, { reader, review, cityPreset, CITIES, hoursLines, count, extractSummary: summary, readerErr: ERR });
})();
