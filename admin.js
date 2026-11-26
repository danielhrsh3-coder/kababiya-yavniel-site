/* admin.js - מצב עריכה לבעל העסק.
   נטען רק כשמבקשים עריכה (לחיצה על המנעול בתחתית האתר, או ?edit=1 בכתובת).
   העריכה נעשית על האתר עצמו, בדיוק כמו שהלקוחות רואים אותו:
   עיפרון ליד כל מנה, כפתור "הוסף מנה", הודעה קופצת, שעות פתיחה, וסלטים/רטבים. */
(function (global) {
  'use strict';

  var doc = document;
  var CFG = global.KABABIA_CONFIG || {};
  var App, Store, S;
  var inEdit = false;
  var chrome = { ribbon: null, bar: null };

  var CAT_LABELS = { grill: 'על האש', hummus: 'חומוס ופלאפל', sides: 'תוספות', drinks: 'שתייה' };

  /* ---------- עזרים ---------- */
  function esc(s) { return App.esc(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(root, sel) { return root.querySelector(sel); }
  function hasHebrew(s) { return /[֐-׿]/.test(String(s || '')); }

  function sectionOf(cat) { return (cat === 'grill' || cat === 'hummus') ? 'main' : cat; }
  function dishSection(d) { return d.special_date ? 'special' : sectionOf(d.cat); }

  function sortDishes() {
    S.dishes = S.dishes.map(function (d, i) { return { d: d, i: i }; })
      .sort(function (a, b) { return (a.d.sort - b.d.sort) || (a.i - b.i); })
      .map(function (x) { return x.d; });
  }

  function sortReviews() {
    S.reviews = S.reviews.map(function (d, i) { return { d: d, i: i }; })
      .sort(function (a, b) { return (a.d.sort - b.d.sort) || (a.i - b.i); })
      .map(function (x) { return x.d; });
  }

  function normPrice(v) {
    var s = String(v == null ? '' : v).replace(/[₪\s]/g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : String(v).trim();
  }

  /* ---------- הודעות קטנות (toast) ---------- */
  function toast(msg, type) {
    var host = doc.querySelector('.ed-toasts');
    if (!host) {
      host = doc.createElement('div');
      host.className = 'ed-toasts';
      host.setAttribute('aria-live', 'polite');
      doc.body.appendChild(host);
    }
    var t = doc.createElement('div');
    t.className = 'ed-toast' + (type === 'error' ? ' is-error' : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, type === 'error' ? 6000 : 3000);
  }

  /* ---------- חלון קופץ ---------- */
  function openModal(html, cls, ovCls) {
    var ov = doc.createElement('div');
    ov.className = 'ed-overlay' + (ovCls ? ' ' + ovCls : '');
    ov.innerHTML = '<div class="ed-modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    doc.body.appendChild(ov);
    doc.body.classList.add('ed-lock');
    var modal = ov.firstChild;
    var api = {
      el: modal,
      close: function () {
        doc.removeEventListener('keydown', onKey);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (!doc.querySelector('.ed-overlay')) doc.body.classList.remove('ed-lock');
        if (api.onClose) api.onClose();
      },
      onClose: null
    };
    var locked = !!(CFG.gateAll && ovCls && /ed-gate-ov/.test(ovCls));   // אתר פרטי: אי אפשר לברוח ממסך הכניסה
    function onKey(e) {
      var top = doc.querySelectorAll('.ed-overlay');
      if (e.key === 'Escape' && !locked && top[top.length - 1] === ov) api.close();
    }
    doc.addEventListener('keydown', onKey);
    return api;
  }

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var m = openModal(
        '<h2 class="ed-title">' + esc(o.title) + '</h2>' +
        (o.text ? '<p class="ed-text">' + esc(o.text) + '</p>' : '') +
        '<div class="ed-actions">' +
          '<button type="button" class="ed-btn ' + (o.danger ? 'ed-btn-danger' : 'ed-btn-primary') + '" data-yes>' + esc(o.ok || 'אישור') + '</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-no>ביטול</button>' +
        '</div>', 'ed-modal-small');
      var done = false;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      $(m.el, '[data-yes]').addEventListener('click', function () { finish(true); });
      $(m.el, '[data-no]').addEventListener('click', function () { finish(false); });
      m.onClose = function () { finish(false); };
    });
  }

  /* ---------- תמונה: הקטנה לפני שמירה ---------- */
  function resizeImage(file, maxSide, quality) {
    maxSide = maxSide || 900; quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      function draw(src, w, h, cleanup) {
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = doc.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(src, 0, 0, cw, ch);
        if (cleanup) cleanup();
        c.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('לא הצלחנו לעבד את התמונה'));
        }, 'image/jpeg', quality);
      }
      function fallback() {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { draw(img, img.naturalWidth, img.naturalHeight, function () { URL.revokeObjectURL(url); }); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('הקובץ שנבחר אינו תמונה')); };
        img.src = url;
      }
      if (global.createImageBitmap) {
        global.createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
          draw(bmp, bmp.width, bmp.height, function () { if (bmp.close) bmp.close(); });
        }).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  /* בורר תמונה קטן: כפתור בחירה, תצוגה מקדימה, הסרה. משמש את ההודעה הקופצת */
  function photoPicker(root, initialUrl, onError, maxSide) {
    var st = { blob: null, previewURL: null, removed: false };
    var fileIn = $(root, 'input[type=file]');
    var box = $(root, '[data-preview]');
    var pick = $(root, '[data-act=pick]');
    var del = $(root, '[data-act=unphoto]');
    function src() { return st.blob ? st.previewURL : (st.removed ? '' : (initialUrl || '')); }
    function refresh() {
      var u = src();
      box.innerHTML = u ? '<img alt="" src="' + esc(u) + '">' : '<span>אין תמונה</span>';
      del.hidden = !u;
      pick.textContent = u ? '📷 החלף תמונה' : '📷 בחר תמונה';
    }
    refresh();
    pick.addEventListener('click', function () { fileIn.click(); });
    del.addEventListener('click', function () { st.blob = null; st.removed = true; refresh(); });
    fileIn.addEventListener('change', function () {
      var file = fileIn.files && fileIn.files[0];
      if (!file) return;
      resizeImage(file, maxSide || 1100, 0.85).then(function (blob) {
        if (st.previewURL) { try { URL.revokeObjectURL(st.previewURL); } catch (e) {} }
        st.blob = blob; st.removed = false;
        st.previewURL = URL.createObjectURL(blob);
        refresh();
      }, function (er) { onError(er.message || 'לא הצלחנו לקרוא את התמונה'); });
      fileIn.value = '';
    });
    return {
      src: src,
      resolve: function () {
        if (st.blob) return Store.uploadImage(st.blob);
        return Promise.resolve(st.removed ? '' : (initialUrl || ''));
      },
      dispose: function () { if (st.previewURL) { try { URL.revokeObjectURL(st.previewURL); } catch (e) {} } }
    };
  }

  /* ---------- שגיאות ---------- */
  function fail(err, what) {
    if (global.console) console.error(err);
    if (err && err.auth) {
      toast('פג תוקף הכניסה. צריך להיכנס שוב.', 'error');
      Store.logout();
      if (CFG.gateAll) { setTimeout(function () { global.location.reload(); }, 600); return; }
      exit();
      setTimeout(start, 400);
      return;
    }
    var extra = err && hasHebrew(err.message) ? ' (' + err.message + ')' : '';
    toast('לא הצלחנו ' + (what || 'לשמור') + '. בדוק שיש אינטרנט ונסה שוב.' + extra, 'error');
  }

  function flash(id) {
    var el = doc.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    el.classList.add('ed-flash');
    setTimeout(function () { el.classList.remove('ed-flash'); }, 2200);
  }

  /* ======================================================================
     כניסה
     ====================================================================== */
  function loginDialog() {
    return new Promise(function (resolve) {
      var live = Store.live;
      var saved = '';
      if (CFG.rememberLogin !== false) { try { saved = global.localStorage.getItem('kababia.email') || ''; } catch (e) {} }
      var m = openModal(
        '<form class="ed-form" novalidate>' +
          '<h2 class="ed-title">🔒 כניסה לעריכת האתר</h2>' +
          '<label class="ed-field"><span class="ed-label">' + (live ? 'אימייל' : 'שם משתמש') + '</span>' +
            (live ? '<input class="ed-input" name="email" type="email" autocomplete="username" inputmode="email" dir="ltr">'
                  : '<input class="ed-input" name="email" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" dir="auto">') + '</label>' +
          '<label class="ed-field"><span class="ed-label">סיסמה</span>' +
            '<input class="ed-input" name="password" type="password" autocomplete="current-password" dir="ltr"></label>' +
          '<p class="ed-error" role="alert" hidden></p>' +
          '<div class="ed-actions">' +
            '<button type="submit" class="ed-btn ed-btn-primary">כניסה</button>' +
            (CFG.gateAll ? '' : '<button type="button" class="ed-btn ed-btn-ghost" data-cancel>ביטול</button>') +
          '</div>' +
        '</form>', 'ed-modal-small', /\bed-gate\b/.test(doc.documentElement.className) ? 'ed-gate-ov' : '');
      var form = $(m.el, 'form');
      var email = form.elements.email, pass = form.elements.password;
      var err = $(m.el, '.ed-error');
      var done = false;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      email.value = saved;
      setTimeout(function () { (email.value ? pass : email).focus(); }, 50);
      m.onClose = function () { finish(false); };
      var cancelBtn = $(m.el, '[data-cancel]');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { finish(false); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.hidden = true;
        var btn = $(m.el, '.ed-btn-primary');
        btn.disabled = true; btn.textContent = 'נכנס…';
        Store.login(email.value.trim(), pass.value).then(function () {
          if (CFG.rememberLogin !== false) { try { global.localStorage.setItem('kababia.email', email.value.trim()); } catch (x) {} }
          finish(true);
        }, function (er) {
          btn.disabled = false; btn.textContent = 'כניסה';
          err.textContent = er && er.badCredentials ? (live ? 'האימייל או הסיסמה לא נכונים' : 'שם המשתמש או הסיסמה לא נכונים')
            : er && er.notConfigured ? 'העריכה עדיין לא חוברה לשרת.'
            : 'לא הצלחנו להתחבר. בדוק חיבור לאינטרנט ונסה שוב.';
          err.hidden = false;
        });
      });
    });
  }

  /* ======================================================================
     טופס מנה
     ====================================================================== */
  function dishFormHTML(isNew) {
    return '<form class="ed-form" novalidate>' +
      '<h2 class="ed-title">' + (isNew ? '➕ מנה חדשה' : '✏️ עריכת מנה') + '</h2>' +

      '<label class="ed-field"><span class="ed-label">איך קוראים למנה?</span>' +
        '<input class="ed-input" name="name" type="text" maxlength="80" autocomplete="off" placeholder="לדוגמה: קוסקוס של הבית"></label>' +

      '<div class="ed-field" data-price-box>' +
        '<span class="ed-label">כמה היא עולה?</span>' +
        '<div class="ed-single"><input class="ed-input ed-price" name="price" type="text" inputmode="decimal" autocomplete="off" placeholder="45"><span class="ed-shekel">₪</span></div>' +
        '<div class="ed-sizes" hidden>' +
          '<div class="ed-sizes-rows"></div>' +
          '<button type="button" class="ed-link" data-act="add-size">＋ הוסף גודל</button>' +
        '</div>' +
        '<button type="button" class="ed-link" data-act="sizes"></button>' +
      '</div>' +

      '<label class="ed-field"><span class="ed-label">הערה קטנה מתחת לשם <small>(לא חובה)</small></span>' +
        '<input class="ed-input" name="note" type="text" maxlength="60" autocomplete="off" placeholder="לדוגמה: קציצה נוספת +10 ₪"></label>' +

      '<div class="ed-field"><span class="ed-label">תמונה</span>' +
        '<div class="ed-photo">' +
          '<div class="ed-photo-preview" data-preview></div>' +
          '<div class="ed-photo-btns">' +
            '<button type="button" class="ed-btn ed-btn-secondary" data-act="pick">📷 בחר תמונה</button>' +
            '<button type="button" class="ed-link" data-act="unphoto" hidden>הסר תמונה</button>' +
          '</div>' +
          '<input type="file" accept="image/*" hidden>' +
        '</div>' +
      '</div>' +

      '<div class="ed-field" data-cat-box><span class="ed-label">איפה בתפריט?</span>' +
        '<div class="ed-chips" role="radiogroup">' +
          Object.keys(CAT_LABELS).map(function (k) {
            return '<button type="button" class="ed-chip" role="radio" data-cat="' + k + '">' + CAT_LABELS[k] + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="ed-field"><span class="ed-label">מתי להציג אותה?</span>' +
        '<div class="ed-cards">' +
          '<label class="ed-card"><input type="radio" name="when" value="always"><span><b>תמיד</b><small>מנה קבועה בתפריט</small></span></label>' +
          '<label class="ed-card"><input type="radio" name="when" value="date"><span><b>🔥 ספיישל (לזמן מוגבל)</b><small>מופיע בקטגוריה מיוחדת בראש התפריט, ונעלם לבד בסוף התקופה</small></span></label>' +
          '<div class="ed-date" hidden>' +
            '<div class="ed-date-quick">' +
              '<button type="button" class="ed-chip" data-quick="today">היום בלבד</button>' +
              '<button type="button" class="ed-chip" data-quick="tomorrow">מחר בלבד</button>' +
            '</div>' +
            '<label class="ed-date-pick"><span>מתאריך</span><input class="ed-input" name="date" type="date"></label>' +
            '<label class="ed-date-pick"><span>עד תאריך <small>(אם זה לכמה ימים)</small></span><input class="ed-input" name="until" type="date"></label>' +
            '<button type="button" class="ed-link" data-act="clear-until" hidden>רק יום אחד (ביטול תאריך הסיום)</button>' +
          '</div>' +
          '<label class="ed-card"><input type="radio" name="when" value="hidden"><span><b>מוסתרת</b><small>לא מופיעה כרגע, אפשר להחזיר מתי שרוצים</small></span></label>' +
        '</div>' +
      '</div>' +

      '<p class="ed-error" role="alert" hidden></p>' +
      '<div class="ed-actions">' +
        '<button type="submit" class="ed-btn ed-btn-primary">💾 שמור</button>' +
        '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
      '</div>' +
      (isNew ? '' :
        '<div class="ed-more">' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="up">⬆ הזז למעלה</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="down">⬇ הזז למטה</button>' +
          '<button type="button" class="ed-btn ed-btn-danger" data-act="delete">🗑 מחק מנה</button>' +
        '</div>') +
    '</form>';
  }

  function openDishForm(dish, defaults) {
    var isNew = !dish;
    var today = Store.todayIL();
    var base = dish ? clone(dish) : {
      id: null, cat: 'grill', name: '', note: '', image: '', placeholder: '',
      prices: [{ label: '', price: '' }], visible: true, special_date: null, special_until: null, sort: 0
    };
    if (defaults) Object.keys(defaults).forEach(function (k) { base[k] = defaults[k]; });
    if (!base.prices || !base.prices.length) base.prices = [{ label: '', price: '' }];
    if (isNew && defaults && defaults.special_date) base.special_date = defaults.special_date;

    var f = {
      cat: base.cat,
      sizesOn: base.prices.length > 1 || !!base.prices[0].label,
      rows: clone(base.prices),
      single: String(base.prices[0].price == null ? '' : base.prices[0].price),
      mode: base.visible === false ? 'hidden' : (base.special_date ? 'date' : 'always'),
      date: base.special_date || today,
      until: base.special_until || '',
      blob: null,
      removeImage: false,
      previewURL: null
    };

    var m = openModal(dishFormHTML(isNew), 'ed-modal-form');
    var el = m.el;
    var form = $(el, 'form');
    var errEl = $(el, '.ed-error');
    var nameIn = form.elements.name;
    var priceIn = form.elements.price;
    var noteIn = form.elements.note;
    var fileIn = $(el, 'input[type=file]');
    var dateIn = form.elements.date;
    var untilIn = form.elements.until;

    nameIn.value = base.name;
    noteIn.value = base.note || '';
    priceIn.value = f.single;
    dateIn.value = f.date;
    untilIn.value = f.until;
    untilIn.min = today;

    m.onClose = function () { if (f.previewURL) { try { URL.revokeObjectURL(f.previewURL); } catch (e) {} } };

    function showError(msg, focusEl) {
      errEl.textContent = msg; errEl.hidden = false;
      if (focusEl) { try { focusEl.focus(); } catch (e) {} }
      try { errEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }

    /* מחיר: אחד או כמה גדלים */
    function renderSizes() {
      var box = $(el, '.ed-sizes-rows');
      box.innerHTML = f.rows.map(function (r, i) {
        return '<div class="ed-size-row" data-i="' + i + '">' +
          '<input class="ed-input" data-k="label" list="ed-size-names" maxlength="30" placeholder="פיתה / בגט / צלחת" value="' + esc(r.label) + '">' +
          '<input class="ed-input ed-price" data-k="price" inputmode="decimal" placeholder="42" value="' + esc(r.price) + '">' +
          '<span class="ed-shekel">₪</span>' +
          '<button type="button" class="ed-x" data-del="' + i + '" aria-label="הסר גודל">✕</button>' +
        '</div>';
      }).join('') +
      '<datalist id="ed-size-names"><option value="פיתה"><option value="בגט"><option value="צלחת"><option value="קטן"><option value="גדול"></datalist>';
    }
    function refreshPriceUI() {
      $(el, '.ed-single').hidden = f.sizesOn;
      $(el, '.ed-sizes').hidden = !f.sizesOn;
      $(el, '[data-act=sizes]').textContent = f.sizesOn ? 'מחיר אחד בלבד' : 'יש כמה גדלים? (פיתה / בגט / צלחת)';
      if (f.sizesOn) renderSizes(); else priceIn.value = f.single;
    }
    refreshPriceUI();

    priceIn.addEventListener('input', function () { f.single = priceIn.value; });
    $(el, '.ed-sizes-rows').addEventListener('input', function (e) {
      var row = e.target.closest('.ed-size-row');
      if (row && e.target.dataset.k) f.rows[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
    });
    $(el, '.ed-sizes-rows').addEventListener('click', function (e) {
      var x = e.target.closest('[data-del]');
      if (!x) return;
      f.rows.splice(Number(x.dataset.del), 1);
      if (!f.rows.length) f.rows.push({ label: '', price: '' });
      renderSizes();
    });

    /* תמונה */
    function refreshPhoto() {
      var box = $(el, '[data-preview]');
      var src = f.blob ? f.previewURL : (f.removeImage ? '' : base.image);
      box.innerHTML = src ? '<img alt="" src="' + esc(src) + '">' : '<span>אין תמונה</span>';
      $(el, '[data-act=unphoto]').hidden = !src;
      $(el, '[data-act=pick]').textContent = src ? '📷 החלף תמונה' : '📷 בחר תמונה';
    }
    refreshPhoto();
    fileIn.addEventListener('change', function () {
      var file = fileIn.files && fileIn.files[0];
      if (!file) return;
      resizeImage(file).then(function (blob) {
        if (f.previewURL) { try { URL.revokeObjectURL(f.previewURL); } catch (e) {} }
        f.blob = blob; f.removeImage = false;
        f.previewURL = URL.createObjectURL(blob);
        refreshPhoto();
      }, function (er) { showError(er.message || 'לא הצלחנו לקרוא את התמונה'); });
      fileIn.value = '';
    });

    /* קטגוריה */
    function refreshCat() {
      Array.prototype.forEach.call(el.querySelectorAll('.ed-chip[data-cat]'), function (c) {
        var on = c.dataset.cat === f.cat;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    refreshCat();

    /* מתי להציג */
    function refreshWhen() {
      Array.prototype.forEach.call(form.elements.when, function (r) { r.checked = (r.value === f.mode); });
      $(el, '.ed-date').hidden = f.mode !== 'date';
      $(el, '[data-cat-box]').hidden = f.mode === 'date';   // ספיישל מופיע בקטגוריה משלו
      dateIn.value = f.date;
      untilIn.value = f.until;
      $(el, '[data-act=clear-until]').hidden = !f.until;
      var single = !f.until || f.until === f.date;
      $(el, '[data-quick=today]').classList.toggle('is-on', single && f.date === today);
      $(el, '[data-quick=tomorrow]').classList.toggle('is-on', single && f.date === Store.addDays(today, 1));
    }
    refreshWhen();
    dateIn.addEventListener('change', function () {
      f.date = dateIn.value;
      if (f.until && f.until < f.date) f.until = '';
      refreshWhen();
    });
    untilIn.addEventListener('change', function () { f.until = untilIn.value; refreshWhen(); });

    /* לחיצות */
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button, input[name=when]');
      if (!t) return;
      if (t.dataset.cat) { f.cat = t.dataset.cat; refreshCat(); return; }
      if (t.dataset.quick) {
        f.date = t.dataset.quick === 'today' ? today : Store.addDays(today, 1);
        f.until = '';
        refreshWhen();
        return;
      }
      if (t.name === 'when') { f.mode = t.value; refreshWhen(); return; }
      switch (t.dataset.act) {
        case 'sizes':
          if (!f.sizesOn) {
            f.sizesOn = true;
            f.rows = [{ label: 'פיתה', price: f.single }, { label: 'בגט', price: '' }];
          } else {
            f.sizesOn = false;
            var first = f.rows.filter(function (r) { return String(r.price).trim() !== ''; })[0];
            f.single = first ? String(first.price) : '';
          }
          refreshPriceUI();
          break;
        case 'add-size':
          f.rows.push({ label: '', price: '' });
          renderSizes();
          break;
        case 'pick': fileIn.click(); break;
        case 'clear-until': f.until = ''; refreshWhen(); break;
        case 'unphoto':
          f.blob = null; f.removeImage = true;
          refreshPhoto();
          break;
        case 'cancel': m.close(); break;
        case 'delete': deleteDish(dish).then(function (ok) { if (ok) m.close(); }); break;
        case 'up': moveDish(dish, -1).then(function (ok) { if (ok) m.close(); }); break;
        case 'down': moveDish(dish, 1).then(function (ok) { if (ok) m.close(); }); break;
      }
    });

    /* שמירה */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errEl.hidden = true;

      var name = nameIn.value.trim();
      if (!name) return showError('חסר שם למנה', nameIn);

      var prices;
      if (!f.sizesOn) {
        var v = String(f.single).trim();
        if (!v) return showError('חסר מחיר', priceIn);
        prices = [{ label: '', price: normPrice(v) }];
      } else {
        prices = f.rows.filter(function (r) { return String(r.price).trim() !== '' || String(r.label).trim() !== ''; })
          .map(function (r) { return { label: String(r.label).trim(), price: normPrice(r.price) }; });
        if (!prices.length) return showError('חסר מחיר');
        if (prices.some(function (p) { return String(p.price).trim() === ''; })) return showError('חסר מחיר באחד הגדלים');
        if (prices.length > 1 && prices.some(function (p) { return !p.label; })) return showError('חסר שם לאחד הגדלים (למשל: פיתה)');
      }

      var special = null, until = null, visible = true;
      if (f.mode === 'hidden') visible = false;
      if (f.mode === 'date') {
        if (!f.date) return showError('בחר את התאריך של הספיישל');
        if (f.until && f.until < f.date) return showError('תאריך הסיום קודם לתאריך ההתחלה');
        if ((f.until || f.date) < today) return showError('התאריך שבחרת כבר עבר');
        special = f.date;
        until = (f.until && f.until !== f.date) ? f.until : null;
      }

      var sorts = S.dishes.map(function (x) { return x.sort || 0; });
      var sort = base.sort;
      if (isNew) sort = (f.mode === 'date') ? Math.min.apply(null, sorts.concat([0])) - 1 : Math.max.apply(null, sorts.concat([0])) + 1;

      var btn = $(el, '.ed-btn-primary');
      btn.disabled = true; btn.textContent = 'שומר…';

      var imgStep = f.blob ? Store.uploadImage(f.blob) : Promise.resolve(f.removeImage ? '' : base.image);
      imgStep.then(function (image) {
        var out = clone(base);
        out.name = name; out.note = noteIn.value.trim(); out.cat = f.cat; out.prices = prices;
        out.image = image; out.visible = visible; out.special_date = special; out.special_until = until; out.sort = sort;
        return Store.saveDish(out);
      }).then(function (saved) {
        var idx = -1;
        S.dishes.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
        if (idx >= 0) S.dishes[idx] = saved; else S.dishes.push(saved);
        sortDishes();
        App.applyFilter('all');
        App.render();
        m.close();
        flash(saved.id);
        toast(f.mode === 'date' ? (isNew ? 'הספיישל נוסף ✓' : 'הספיישל נשמר ✓') : (isNew ? 'המנה נוספה ✓' : 'נשמר ✓'));
      }, function (er) {
        btn.disabled = false; btn.textContent = '💾 שמור';
        fail(er, 'לשמור');
      });
    });

    setTimeout(function () { if (isNew) nameIn.focus(); }, 60);
  }

  function deleteDish(d) {
    return confirmDialog({
      title: 'למחוק את "' + d.name + '"?',
      text: 'אי אפשר לשחזר אחרי המחיקה. אם רק רוצים להסתיר אותה לזמן מה, עדיף לבחור "מוסתרת" בעריכה.',
      ok: 'כן, מחק', danger: true
    }).then(function (yes) {
      if (!yes) return false;
      return Store.deleteDish(d.id).then(function () {
        S.dishes = S.dishes.filter(function (x) { return x.id !== d.id; });
        App.render();
        toast('המנה נמחקה');
        return true;
      }, function (er) { fail(er, 'למחוק'); return false; });
    });
  }

  function moveDish(d, dir) {
    var sec = dishSection(d);
    var list = S.dishes.filter(function (x) { return dishSection(x) === sec; });
    var i = list.map(function (x) { return x.id; }).indexOf(d.id);
    var j = i + dir;
    if (j < 0 || j >= list.length) {
      toast(dir < 0 ? 'המנה כבר ראשונה' : 'המנה כבר אחרונה');
      return Promise.resolve(false);
    }
    var needsRenumber = list.some(function (x, k) { return k > 0 && x.sort <= list[k - 1].sort; });
    if (needsRenumber) list.forEach(function (x, k) { x.sort = (k + 1) * 10; });
    var a = list[i], b = list[j];
    var tmp = a.sort; a.sort = b.sort; b.sort = tmp;
    var changed = needsRenumber ? list : [a, b];
    return Promise.all(changed.map(function (x) { return Store.saveDish(x); })).then(function () {
      sortDishes();
      App.applyFilter('all');
      App.render();
      flash(d.id);
      toast('הוזז ✓');
      return true;
    }, function (er) { fail(er, 'להזיז'); App.reload(); return false; });
  }

  /* ======================================================================
     הודעה קופצת
     ====================================================================== */
  function openPopupForm() {
    var s = S.settings;
    var today = Store.todayIL();
    var m = openModal(
      '<form class="ed-form" novalidate>' +
        '<h2 class="ed-title">📢 הודעה קופצת באתר</h2>' +
        '<p class="ed-text">ההודעה קופצת ללקוח כשהוא נכנס לאתר (פעם אחת בכל ביקור). אפשר לכתוב עליה, למשל, ספיישל של מחר או שינוי בשעות, ולהוסיף תמונה.</p>' +
        '<label class="ed-field"><span class="ed-label">מה לכתוב בהודעה?</span>' +
          '<textarea class="ed-input ed-textarea" name="text" rows="4" maxlength="300" placeholder="לדוגמה: מחר בלבד! קוסקוס של הבית, כמות מוגבלת"></textarea></label>' +
        '<div class="ed-field"><span class="ed-label">תמונה <small>(לא חובה)</small></span>' +
          '<div class="ed-photo ed-photo-wide">' +
            '<div class="ed-photo-preview ed-photo-rect" data-preview></div>' +
            '<div class="ed-photo-btns">' +
              '<button type="button" class="ed-btn ed-btn-secondary" data-act="pick">📷 בחר תמונה</button>' +
              '<button type="button" class="ed-link" data-act="unphoto" hidden>הסר תמונה</button>' +
            '</div>' +
            '<input type="file" accept="image/*" hidden>' +
          '</div>' +
        '</div>' +
        '<label class="ed-switch"><input type="checkbox" name="on"><span class="ed-switch-ui"></span><span>להציג את ההודעה באתר</span></label>' +
        '<div class="ed-field"><span class="ed-label">להפסיק להציג אחרי תאריך <small>(לא חובה)</small></span>' +
          '<div class="ed-date-quick"><button type="button" class="ed-chip" data-day="0">היום</button><button type="button" class="ed-chip" data-day="1">מחר</button><button type="button" class="ed-chip" data-day="clear">בלי הגבלה</button></div>' +
          '<input class="ed-input" name="until" type="date"></div>' +
        '<p class="ed-error" role="alert" hidden></p>' +
        '<div class="ed-actions">' +
          '<button type="submit" class="ed-btn ed-btn-primary">💾 שמור</button>' +
          '<button type="button" class="ed-btn ed-btn-secondary" data-act="preview">👁 איך זה ייראה</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
        '</div>' +
      '</form>', 'ed-modal-form');
    var el = m.el, form = $(el, 'form'), err = $(el, '.ed-error');
    function showErr(msg) { err.textContent = msg; err.hidden = false; }
    var picker = photoPicker(el, s.popup_image || '', showErr, 1100);
    m.onClose = function () { picker.dispose(); };

    form.elements.text.value = s.popup_text || '';
    form.elements.on.checked = !!s.popup_enabled;
    form.elements.until.value = s.popup_until || '';
    form.elements.until.min = today;

    function markDays() {
      Array.prototype.forEach.call(el.querySelectorAll('[data-day]'), function (b) {
        var v = form.elements.until.value;
        var on = b.dataset.day === 'clear' ? !v : v === Store.addDays(today, Number(b.dataset.day));
        b.classList.toggle('is-on', on);
      });
    }
    markDays();
    form.elements.until.addEventListener('change', markDays);

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.day !== undefined) {
        form.elements.until.value = t.dataset.day === 'clear' ? '' : Store.addDays(today, Number(t.dataset.day));
        markDays();
      } else if (t.dataset.act === 'cancel') {
        m.close();
      } else if (t.dataset.act === 'preview') {
        var txt = form.elements.text.value.trim();
        var img = picker.src();
        if (!txt && !img) { showErr('כתוב קודם הודעה או הוסף תמונה'); return; }
        err.hidden = true;
        App.previewPopup(txt, img);
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var text = form.elements.text.value.trim();
      var on = form.elements.on.checked;
      if (on && !text && !picker.src()) { showErr('כדי להציג הודעה צריך לכתוב טקסט או להוסיף תמונה'); form.elements.text.focus(); return; }
      var until = form.elements.until.value || null;
      if (until && until < today) { showErr('התאריך שבחרת כבר עבר'); return; }
      var btn = $(el, '.ed-btn-primary');
      btn.disabled = true; btn.textContent = 'שומר…';
      picker.resolve().then(function (image) {
        var next = Object.assign({}, S.settings, { popup_text: text, popup_enabled: on, popup_until: until, popup_image: image });
        return Store.saveSettings(next);
      }).then(function (saved) {
        S.settings = saved;
        m.close();
        toast(on ? 'ההודעה נשמרה ותופיע ללקוחות ✓' : 'ההודעה נשמרה (כרגע כבויה)');
      }, function (er) { btn.disabled = false; btn.textContent = '💾 שמור'; fail(er, 'לשמור'); });
    });
  }

  /* ======================================================================
     שעות פתיחה: קבועות לכל יום + שינויים זמניים (חג, חופשה, יום קצר)
     ====================================================================== */
  function openHoursForm() {
    var H = global.KababiaHours;
    if (!H) { toast('מסך השעות לא נטען, רענן את הדף ונסה שוב', 'error'); return; }
    var today = Store.todayIL();
    var weekly = H.normHours(S.settings.hours);
    var overrides = H.normOverrides(S.settings.hours_overrides).filter(function (o) { return o.to >= today; });
    var addMode = 'closed';

    var rows = H.DAY_NAMES.map(function (name, d) {
      var w = weekly[d];
      return '<div class="ed-hours-row" data-d="' + d + '">' +
        '<label class="ed-switch"><input type="checkbox" data-on' + (w ? ' checked' : '') + '><span class="ed-switch-ui"></span><span>' + name + '</span></label>' +
        '<span class="ed-hours-times" dir="ltr">' +
          '<input class="ed-input" type="time" data-open aria-label="פתיחה ב' + name + '" value="' + (w ? w.open : '12:00') + '">' +
          '<span aria-hidden="true">–</span>' +
          '<input class="ed-input" type="time" data-close aria-label="סגירה ב' + name + '" value="' + (w ? w.close : '22:00') + '">' +
        '</span>' +
        '<span class="ed-hours-closed">סגור</span>' +
      '</div>';
    }).join('');

    var m = openModal(
      '<form class="ed-form" novalidate>' +
        '<h2 class="ed-title">🕐 שעות פתיחה</h2>' +
        '<p class="ed-text">השעות מופיעות באתר, והן קובעות מתי כתוב "פתוח עכשיו". הכול לפי שעון ישראל.</p>' +
        '<h3 class="ed-sub">שעות קבועות</h3>' +
        '<div class="ed-hours-list">' + rows + '</div>' +
        '<h3 class="ed-sub">שינוי זמני <small>(חג, חופשה, יום קצר)</small></h3>' +
        '<p class="ed-text ed-text-small">שינוי זמני גובר על השעות הקבועות בתאריכים שבחרת, ונעלם לבד אחרי שהם עוברים.</p>' +
        '<div class="ed-ovr-list"></div>' +
        '<button type="button" class="ed-btn ed-btn-secondary" data-act="add-ovr">＋ הוסף שינוי זמני</button>' +
        '<div class="ed-ovr-form" hidden>' +
          '<div class="ed-field"><span class="ed-label">מתאריך</span><input class="ed-input" type="date" name="ofrom" min="' + today + '"></div>' +
          '<div class="ed-field"><span class="ed-label">עד תאריך <small>(לא חובה, ריק = יום אחד)</small></span><input class="ed-input" type="date" name="oto" min="' + today + '"></div>' +
          '<div class="ed-field"><span class="ed-label">מה קורה בימים האלה?</span>' +
            '<div class="ed-chips">' +
              '<button type="button" class="ed-chip is-on" data-mode="closed">סגור</button>' +
              '<button type="button" class="ed-chip" data-mode="hours">שעות אחרות</button>' +
            '</div>' +
            '<div class="ed-ovr-times" dir="ltr" hidden>' +
              '<input class="ed-input" type="time" name="oopen" value="12:00" aria-label="פתיחה">' +
              '<span aria-hidden="true">–</span>' +
              '<input class="ed-input" type="time" name="oclose" value="16:00" aria-label="סגירה">' +
            '</div>' +
          '</div>' +
          '<label class="ed-field"><span class="ed-label">הערה ללקוחות <small>(לא חובה)</small></span>' +
            '<input class="ed-input" name="onote" maxlength="60" placeholder="למשל: ערב חג"></label>' +
          '<p class="ed-error ed-ovr-error" role="alert" hidden></p>' +
          '<div class="ed-actions">' +
            '<button type="button" class="ed-btn ed-btn-secondary" data-act="ovr-ok">הוסף לרשימה</button>' +
            '<button type="button" class="ed-btn ed-btn-ghost" data-act="ovr-cancel">ביטול</button>' +
          '</div>' +
        '</div>' +
        '<p class="ed-error ed-main-error" role="alert" hidden></p>' +
        '<div class="ed-actions ed-actions-end">' +
          '<button type="submit" class="ed-btn ed-btn-primary">💾 שמור</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
        '</div>' +
        '<p class="ed-text ed-text-small">שינויים (גם שינוי זמני שהוספת) נשמרים רק אחרי לחיצה על "שמור".</p>' +
      '</form>', 'ed-modal-form');

    var el = m.el, form = $(el, 'form');
    var mainErr = $(el, '.ed-main-error'), ovrErr = $(el, '.ed-ovr-error');
    var ovrForm = $(el, '.ed-ovr-form'), ovrList = $(el, '.ed-ovr-list');

    function refreshRow(row) {
      var on = $(row, '[data-on]').checked;
      row.classList.toggle('is-off', !on);
    }
    Array.prototype.forEach.call(el.querySelectorAll('.ed-hours-row'), refreshRow);
    el.addEventListener('change', function (e) {
      var row = e.target.closest ? e.target.closest('.ed-hours-row') : null;
      if (row) refreshRow(row);
      mainErr.hidden = true;
    });
    el.addEventListener('input', function () { mainErr.hidden = true; });

    function whenText(o) {
      return o.from === o.to ? H.DAY_NAMES[H.dowOf(o.from)] + ' ' + H.dm(o.from) : H.dm(o.from) + ' עד ' + H.dm(o.to);
    }
    function renderOvr() {
      if (!overrides.length) { ovrList.innerHTML = '<p class="ed-ovr-empty">אין שינויים זמניים.</p>'; return; }
      ovrList.innerHTML = overrides.map(function (o, i) {
        return '<div class="ed-ovr-item"><div class="ed-ovr-main"><b>' + esc(whenText(o)) + '</b>' +
          '<span>' + (o.closed ? 'סגור' : esc(o.open + '–' + o.close)) + (o.note ? ' · ' + esc(o.note) : '') + '</span></div>' +
          '<button type="button" class="ed-link" data-del-ovr="' + i + '">מחק</button></div>';
      }).join('');
    }
    renderOvr();

    function setMode(mode) {
      addMode = mode;
      Array.prototype.forEach.call(el.querySelectorAll('[data-mode]'), function (b) { b.classList.toggle('is-on', b.dataset.mode === mode); });
      $(el, '.ed-ovr-times').hidden = mode !== 'hours';
    }
    function ovrFail(msg) { ovrErr.textContent = msg; ovrErr.hidden = false; }

    el.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.dataset.mode) { setMode(t.dataset.mode); return; }
      if (t.hasAttribute('data-del-ovr')) {
        overrides.splice(Number(t.getAttribute('data-del-ovr')), 1);
        renderOvr();
        return;
      }
      var act = t.dataset.act;
      if (act === 'cancel') m.close();
      else if (act === 'add-ovr') {
        ovrErr.hidden = true;
        ovrForm.hidden = false;
        t.hidden = true;
        form.elements.ofrom.focus();
      } else if (act === 'ovr-cancel') {
        ovrForm.hidden = true;
        $(el, '[data-act=add-ovr]').hidden = false;
      } else if (act === 'ovr-ok') {
        ovrErr.hidden = true;
        var from = form.elements.ofrom.value, to = form.elements.oto.value || from;
        if (!from) return ovrFail('בחר תאריך התחלה');
        if (from < today) return ovrFail('התאריך שבחרת כבר עבר');
        if (to < from) return ovrFail('תאריך הסיום חייב להיות אחרי תאריך ההתחלה');
        var item = { from: from, to: to, closed: addMode === 'closed', note: form.elements.onote.value.trim() };
        if (!item.closed) {
          var r = H.parseRange([form.elements.oopen.value, form.elements.oclose.value]);
          if (!r) return ovrFail('בדוק את השעות: הסגירה חייבת להיות אחרי הפתיחה');
          item.open = r.open; item.close = r.close;
        }
        overrides.push(item);
        overrides = H.normOverrides(overrides).sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
        renderOvr();
        form.elements.ofrom.value = ''; form.elements.oto.value = ''; form.elements.onote.value = '';
        setMode('closed');
        ovrForm.hidden = true;
        $(el, '[data-act=add-ovr]').hidden = false;
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      mainErr.hidden = true;
      var out = [];
      var rowsEl = el.querySelectorAll('.ed-hours-row');
      for (var i = 0; i < rowsEl.length; i++) {
        var row = rowsEl[i], d = Number(row.dataset.d);
        if (!$(row, '[data-on]').checked) { out[d] = null; continue; }
        var r = H.parseRange([$(row, '[data-open]').value, $(row, '[data-close]').value]);
        if (!r) {
          mainErr.textContent = 'בדוק את השעות ביום ' + H.DAY_NAMES[d] + ': הסגירה חייבת להיות אחרי הפתיחה (או כבה את היום)';
          mainErr.hidden = false;
          return;
        }
        out[d] = r;
      }
      var btn = $(el, '.ed-btn-primary');
      btn.disabled = true; btn.textContent = 'שומר…';
      Store.saveHours({ hours: H.serializeHours(out), hours_overrides: H.serializeOverrides(overrides) }).then(function (saved) {
        S.settings = saved;
        try { doc.dispatchEvent(new CustomEvent('kababia:settings', { detail: saved })); } catch (er) {}
        m.close();
        toast('שעות הפתיחה נשמרו ✓');
      }, function (er) { btn.disabled = false; btn.textContent = '💾 שמור'; fail(er, 'לשמור'); });
    });
  }

  /* ======================================================================
     סלטים ורטבים
     ====================================================================== */
  function openFillingsForm() {
    var s = S.settings;
    var m = openModal(
      '<form class="ed-form" novalidate>' +
        '<h2 class="ed-title">🥗 סלטים ורטבים</h2>' +
        '<p class="ed-text">מה הלקוח יכול לבחור לתוך המנה. כל פריט בשורה נפרדת.</p>' +
        '<label class="ed-field"><span class="ed-label">סלטים</span><textarea class="ed-input ed-textarea" name="salads" rows="7"></textarea></label>' +
        '<label class="ed-field"><span class="ed-label">רטבים</span><textarea class="ed-input ed-textarea" name="sauces" rows="7"></textarea></label>' +
        '<p class="ed-error" role="alert" hidden></p>' +
        '<div class="ed-actions">' +
          '<button type="submit" class="ed-btn ed-btn-primary">💾 שמור</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
        '</div>' +
      '</form>', 'ed-modal-form');
    var el = m.el, form = $(el, 'form');
    form.elements.salads.value = App.splitItems(s.salads).join('\n');
    form.elements.sauces.value = App.splitItems(s.sauces).join('\n');
    $(el, '[data-act=cancel]').addEventListener('click', function () { m.close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $(el, '.ed-btn-primary');
      btn.disabled = true; btn.textContent = 'שומר…';
      var next = Object.assign({}, S.settings, {
        salads: App.splitItems(form.elements.salads.value).join(' · '),
        sauces: App.splitItems(form.elements.sauces.value).join(' · ')
      });
      Store.saveSettings(next).then(function (saved) {
        S.settings = saved;
        App.render();
        m.close();
        toast('נשמר ✓');
      }, function (er) { btn.disabled = false; btn.textContent = '💾 שמור'; fail(er, 'לשמור'); });
    });
  }

  /* ======================================================================
     חוות דעת על העסק
     ====================================================================== */
  /* חוות דעת קיימת: תצוגה בלבד. אפשר להזיז, להסתיר או למחוק, אבל לא לשנות טקסט וכוכבים */
  function openReviewView(review) {
    var who = review.author ? esc(review.author) + (review.source ? ' · ' + esc(review.source) : '') : esc(review.source || '');
    var m = openModal(
      '<div class="ed-form">' +
        '<h2 class="ed-title">⭐ חוות דעת' + (review.author ? ' של ' + esc(review.author) : '') + '</h2>' +
        '<p class="ed-text">חוות דעת של לקוחות לא ניתנות לעריכה, כדי שיישארו אמינות. אפשר להזיז, להסתיר או למחוק.</p>' +
        '<div class="ed-quote">' +
          '<div class="ed-quote-stars" aria-label="' + review.stars + ' כוכבים מתוך 5">' + '★★★★★☆☆☆☆☆'.slice(5 - review.stars, 10 - review.stars) + '</div>' +
          '<div class="ed-quote-text">' + esc(review.text) + '</div>' +
          (who ? '<div class="ed-quote-who">— ' + who + '</div>' : '') +
        '</div>' +
        '<label class="ed-switch"><input type="checkbox" name="on"><span class="ed-switch-ui"></span><span>להציג באתר</span></label>' +
        '<div class="ed-more">' +
          '<button type="button" class="ed-btn ed-btn-secondary" data-act="up">⬆ הזז למעלה</button>' +
          '<button type="button" class="ed-btn ed-btn-secondary" data-act="down">⬇ הזז למטה</button>' +
        '</div>' +
        '<div class="ed-actions">' +
          '<button type="button" class="ed-btn ed-btn-primary" data-act="cancel">סגור</button>' +
          '<button type="button" class="ed-btn ed-btn-danger" data-act="delete">🗑 מחק</button>' +
        '</div>' +
      '</div>', 'ed-modal-form');
    var el = m.el;
    var on = $(el, 'input[name=on]');
    on.checked = review.visible !== false;
    on.addEventListener('change', function () {
      var next = on.checked;
      Store.saveReview(Object.assign({}, review, { visible: next })).then(function (saved) {
        review = saved;
        S.reviews = S.reviews.map(function (x) { return x.id === saved.id ? saved : x; });
        App.renderReviews();
        flash(saved.id);
        toast(next ? 'חוות הדעת מוצגת באתר ✓' : 'חוות הדעת הוסתרה מהאתר');
      }, function (er) { on.checked = !next; fail(er, 'לשמור'); });
    });
    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      switch (t.dataset.act) {
        case 'cancel': m.close(); break;
        case 'delete': deleteReview(review).then(function (ok) { if (ok) m.close(); }); break;
        case 'up': moveReview(review, -1).then(function (ok) { if (ok) m.close(); }); break;
        case 'down': moveReview(review, 1).then(function (ok) { if (ok) m.close(); }); break;
      }
    });
  }

  function deleteReview(r) {
    return confirmDialog({
      title: 'למחוק את חוות הדעת' + (r.author ? ' של ' + r.author : '') + '?',
      text: 'אי אפשר לשחזר אחרי המחיקה. אם רק רוצים להסתיר, כבה את "להציג באתר" בעריכה.',
      ok: 'כן, מחק', danger: true
    }).then(function (yes) {
      if (!yes) return false;
      return Store.deleteReview(r.id).then(function () {
        S.reviews = S.reviews.filter(function (x) { return x.id !== r.id; });
        App.renderReviews();
        toast('חוות הדעת נמחקה');
        return true;
      }, function (er) { fail(er, 'למחוק'); return false; });
    });
  }

  function moveReview(r, dir) {
    var list = S.reviews;
    var i = list.map(function (x) { return x.id; }).indexOf(r.id);
    var j = i + dir;
    if (j < 0 || j >= list.length) {
      toast(dir < 0 ? 'כבר ראשונה' : 'כבר אחרונה');
      return Promise.resolve(false);
    }
    var needsRenumber = list.some(function (x, k) { return k > 0 && x.sort <= list[k - 1].sort; });
    if (needsRenumber) list.forEach(function (x, k) { x.sort = (k + 1) * 10; });
    var a = list[i], b = list[j];
    var tmp = a.sort; a.sort = b.sort; b.sort = tmp;
    var changed = needsRenumber ? list.slice() : [a, b];
    return Promise.all(changed.map(function (x) { return Store.saveReview(x); })).then(function () {
      sortReviews();
      App.renderReviews();
      flash(r.id);
      toast('הוזז ✓');
      return true;
    }, function (er) { fail(er, 'להזיז'); App.reload(); return false; });
  }

  /* ======================================================================
     מסגרת העריכה: פס עליון + כפתורים בתחתית
     ====================================================================== */
  /* ======================================================================
     משוב פרטי על האתר: נשלח מתיבת הדירוג בתחתית האתר, גלוי רק לבעלים
     ====================================================================== */
  function setFeedbackBadge(n) {
    var b = chrome.bar && chrome.bar.querySelector('.ed-badge');
    if (!b) return;
    b.textContent = n > 9 ? '9+' : String(n);
    b.hidden = !(n > 0);
  }

  function refreshFeedbackBadge() {
    Store.loadFeedback().then(function (rows) {
      setFeedbackBadge(rows.filter(function (r) { return !r.seen; }).length);
    }, function () { /* התג הוא רק נוחות; שגיאה לא מפריעה */ });
  }

  function feedbackWhen(iso) {
    try {
      var d = new Date(iso), tz = 'Asia/Jerusalem';
      return d.toLocaleDateString('he-IL', { timeZone: tz, day: 'numeric', month: 'numeric' }) + ' · ' +
             d.toLocaleTimeString('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function openFeedbackList() {
    var m = openModal(
      '<div class="ed-form">' +
        '<h2 class="ed-title">💬 משוב על האתר</h2>' +
        '<p class="ed-text">מה גולשים כתבו על האתר עצמו (לא על האוכל). רק אתם רואים את זה.</p>' +
        '<div class="ed-fb-sum" hidden></div>' +
        '<div class="ed-fb-list"><p class="ed-ovr-empty">טוען…</p></div>' +
        '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-primary" data-act="cancel">סגור</button></div>' +
      '</div>', 'ed-modal-form');
    var el = m.el, list = $(el, '.ed-fb-list'), sum = $(el, '.ed-fb-sum');
    var rows = [];

    function render() {
      if (!rows.length) {
        sum.hidden = true;
        list.innerHTML = '<p class="ed-ovr-empty">עדיין אין משוב. כשגולש ידרג את האתר, זה יופיע כאן.</p>';
        return;
      }
      var total = rows.reduce(function (a, r) { return a + r.stars; }, 0);
      sum.textContent = 'ממוצע ' + (total / rows.length).toFixed(1).replace(/\.0$/, '') + ' ★ · ' + rows.length + ' דירוגים';
      sum.hidden = false;
      list.innerHTML = rows.map(function (r) {
        return '<div class="ed-fb-item' + (r.isNew ? ' is-new' : '') + '">' +
          '<div class="ed-fb-head">' +
            '<span class="ed-fb-stars" aria-label="' + r.stars + ' כוכבים מתוך 5">' + '★★★★★☆☆☆☆☆'.slice(5 - r.stars, 10 - r.stars) + '</span>' +
            (r.isNew ? '<span class="ed-fb-new">חדש</span>' : '') +
            '<span class="ed-fb-when">' + esc(feedbackWhen(r.created_at)) + '</span>' +
            '<button type="button" class="ed-fb-del" data-del="' + esc(r.id) + '" aria-label="מחק הערה" title="מחק">🗑</button>' +
          '</div>' +
          (r.comment ? '<div class="ed-fb-text">' + esc(r.comment) + '</div>'
                     : '<div class="ed-fb-text is-empty">דירוג בלי הערה</div>') +
        '</div>';
      }).join('');
    }

    Store.loadFeedback().then(function (r) {
      rows = r.map(function (x) { return Object.assign({}, x, { isNew: !x.seen }); });
      render();
      if (rows.some(function (x) { return x.isNew; })) {
        Store.markFeedbackSeen().then(function () { setFeedbackBadge(0); }, function () {});
      }
    }, function (er) { m.close(); fail(er, 'לטעון את המשוב'); });

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.act === 'cancel') { m.close(); return; }
      if (t.dataset.del) {
        var id = t.dataset.del;
        confirmDialog({
          title: 'למחוק את ההערה?',
          text: 'אי אפשר לשחזר אחרי המחיקה.',
          ok: 'כן, מחק', danger: true
        }).then(function (yes) {
          if (!yes) return;
          Store.deleteFeedback(id).then(function () {
            rows = rows.filter(function (x) { return x.id !== id; });
            render();
            toast('ההערה נמחקה');
          }, function (er) { fail(er, 'למחוק'); });
        });
      }
    });
  }


  /* ======================================================================
     דירוגי מנות (אימוג'י): סיכום ליד כל מנה + פירוט והערות. רק לבעלים.
     ====================================================================== */
  var votes = [];

  function computeVoteStats() {
    var st = {};
    votes.forEach(function (v) {
      var x = st[v.dish_id] || (st[v.dish_id] = { n: 0, sum: 0, avg: 0, comments: 0, dist: [0, 0, 0, 0, 0] });
      x.n++; x.sum += v.score; x.dist[v.score - 1]++;
      if (v.comment) x.comments++;
    });
    Object.keys(st).forEach(function (k) { st[k].avg = st[k].sum / st[k].n; });
    S.voteStats = st;
  }

  function loadVotes() {
    return Store.loadVotes().then(function (rows) {
      votes = rows || [];
      computeVoteStats();
      if (inEdit) App.render();
    }, function () { /* הסיכום הוא תוספת; שגיאה לא מפריעה לעריכה */ });
  }

  function facesBars(dist, n) {
    return '<div class="ed-rate-bars">' + [4, 3, 2, 1, 0].map(function (i) {
      var c = dist[i], pct = n ? Math.round(c * 100 / n) : 0;
      return '<div class="ed-rate-bar"><span class="ed-rate-face" title="' + App.FACE_NAMES[i] + '">' + App.FACES[i] + '</span>' +
        '<span class="ed-rate-track"><span style="width:' + pct + '%"></span></span>' +
        '<span class="ed-rate-num">' + c + '</span></div>';
    }).join('') + '</div>';
  }

  function openRatings(dishId) {
    var d = S.dishes.filter(function (x) { return x.id === dishId; })[0];
    if (!d) return;
    var m = openModal(
      '<div class="ed-form">' +
        '<h2 class="ed-title">' + esc(d.name) + ': דירוגים</h2>' +
        '<p class="ed-text">רק אתם רואים את זה. ללקוחות מוצגות רק 3 המנות המובילות (⭐1, ⭐2, ⭐3), לפי הדירוגים "בסדר" ומעלה, ורק למנה עם 5 דירוגים כאלה לפחות.</p>' +
        '<div class="ed-rate-body"></div>' +
        '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-primary" data-act="cancel">סגור</button></div>' +
      '</div>', 'ed-modal-form');
    var el = m.el, body = $(el, '.ed-rate-body');

    function render() {
      var mine = votes.filter(function (v) { return v.dish_id === dishId; });
      if (!mine.length) { body.innerHTML = '<p class="ed-ovr-empty">עוד אין דירוגים למנה הזו.</p>'; return; }
      var st = S.voteStats[dishId] || { n: 0, avg: 0, dist: [0, 0, 0, 0, 0] };
      var pub = mine.filter(function (v) { return v.score >= 3; });
      var pubAvg = pub.length ? pub.reduce(function (a, v) { return a + v.score; }, 0) / pub.length : 0;
      var comments = mine.filter(function (v) { return v.comment; });
      body.innerHTML =
        '<div class="ed-fb-sum">ממוצע ' + st.avg.toFixed(1) + ' מתוך 5 · ' + st.n + ' דירוגים</div>' +
        facesBars(st.dist, st.n) +
        '<p class="ed-text ed-text-small">לדירוג המוביל נספרים ' + pub.length + ' דירוגים' + (pub.length ? ' (ממוצע ' + pubAvg.toFixed(1) + ')' : '') +
          (pub.length < 5 ? '. צריך לפחות 5 כדי להיכנס.' : '.') + '</p>' +
        '<h3 class="ed-sub">הערות של לקוחות</h3>' +
        (comments.length ? '<div class="ed-fb-list">' + comments.map(function (v) {
          return '<div class="ed-fb-item"><div class="ed-fb-head">' +
            '<span class="ed-rate-face">' + App.FACES[v.score - 1] + '</span>' +
            '<span class="ed-fb-when">' + esc(feedbackWhen(v.created_at)) + '</span>' +
            '<button type="button" class="ed-fb-del" data-del="' + esc(v.id) + '" aria-label="מחק הערה" title="מחק">🗑</button>' +
            '</div><div class="ed-fb-text">' + esc(v.comment) + '</div></div>';
        }).join('') + '</div>' : '<p class="ed-ovr-empty">אין הערות.</p>');
    }
    render();

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.act === 'cancel') { m.close(); return; }
      if (t.dataset.del) {
        var id = t.dataset.del;
        confirmDialog({ title: 'למחוק את הדירוג וההערה?', text: 'אי אפשר לשחזר אחרי המחיקה.', ok: 'כן, מחק', danger: true }).then(function (yes) {
          if (!yes) return;
          Store.deleteVote(id).then(function () {
            votes = votes.filter(function (v) { return v.id !== id; });
            computeVoteStats(); render(); App.render();
            toast('נמחק');
          }, function (er) { fail(er, 'למחוק'); });
        });
      }
    });
  }

  /* ---------- מתג "אזל" ---------- */
  function onSoldOutChange(e) {
    var box = e.target;
    if (!inEdit || !box || !box.hasAttribute || !box.hasAttribute('data-soldout')) return;
    var id = box.getAttribute('data-soldout'), on = box.checked;
    box.disabled = true;
    Store.setSoldOut(id, on).then(function (saved) {
      S.dishes = S.dishes.map(function (x) { return x.id === saved.id ? saved : x; });
      App.render();
      flash(saved.id);
      toast(on ? 'סומן "אזל". המנה מופיעה באפור עד שתחזירו אותה' : 'המנה חזרה לתפריט ✓');
    }, function (er) { box.checked = !on; box.disabled = false; fail(er, 'לשמור'); });
  }

  /* ======================================================================
     דשבורד: ביקורים, לחיצות ודירוגים
     ====================================================================== */
  var RANGES = [
    { k: 'today', label: 'היום', days: 1 },
    { k: 'week', label: 'השבוע', days: 7, sub: '7 הימים האחרונים' },
    { k: 'month', label: 'החודש', days: 30, sub: '30 הימים האחרונים' },
    { k: 'q', label: '3 חודשים', days: 90, sub: '90 הימים האחרונים' }
  ];
  var METRICS = [
    { k: 'visit', label: 'ביקורים באתר', icon: '👀' },
    { k: 'whatsapp', label: 'לחיצות וואטסאפ', icon: '💬' },
    { k: 'call', label: 'לחיצות חיוג', icon: '📞' },
    { k: 'waze', label: 'לחיצות Waze', icon: '🧭' },
    { k: 'votes', label: 'דירוגי מנות', icon: '😁' }
  ];

  function voteDay(v) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v.created_at));
    } catch (e) { return String(v.created_at).slice(0, 10); }
  }

  function sparkSVG(series, label) {
    var w = 300, h = 64, pad = 4, n = series.length;
    var max = Math.max.apply(null, series.concat([1]));
    var pts = series.map(function (y, i) {
      var x = n === 1 ? w / 2 : pad + i * (w - 2 * pad) / (n - 1);
      return x.toFixed(1) + ',' + (h - pad - (y / max) * (h - 2 * pad)).toFixed(1);
    });
    var area = 'M' + pts[0].split(',')[0] + ',' + (h - pad) + ' L' + pts.join(' L') + ' L' + pts[pts.length - 1].split(',')[0] + ',' + (h - pad) + ' Z';
    return '<svg class="ed-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' +
      '<path d="' + area + '" class="ed-spark-area"/>' +
      '<polyline points="' + pts.join(' ') + '" class="ed-spark-line" vector-effect="non-scaling-stroke"/></svg>';
  }

  function changeHTML(cur, prev) {
    if (!prev) return cur ? '<span class="ed-chg is-up">חדש</span>' : '<span class="ed-chg">—</span>';
    var pct = Math.round((cur - prev) * 100 / prev);
    if (pct === 0) return '<span class="ed-chg">0%</span>';
    return '<span class="ed-chg ' + (pct > 0 ? 'is-up' : 'is-down') + '">' + (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%</span>';
  }

  function openDashboard() {
    var today = Store.todayIL();
    var from = Store.addDays(today, -179);
    var range = 'week';
    var byDay = {};   // byDay[kind][day] = n
    var loaded = false;

    var m = openModal(
      '<div class="ed-form">' +
        '<h2 class="ed-title">📊 נתונים</h2>' +
        '<div class="ed-chips ed-range" role="radiogroup">' +
          RANGES.map(function (r) { return '<button type="button" class="ed-chip" role="radio" data-range="' + r.k + '">' + r.label + '</button>'; }).join('') +
        '</div>' +
        '<p class="ed-text ed-text-small ed-range-sub"></p>' +
        '<div class="ed-dash"><p class="ed-ovr-empty">טוען…</p></div>' +
        '<div class="ed-actions"><button type="button" class="ed-btn ed-btn-primary" data-act="cancel">סגור</button></div>' +
      '</div>', 'ed-modal-form ed-modal-wide');
    var el = m.el, dash = $(el, '.ed-dash'), sub = $(el, '.ed-range-sub');

    function sumDays(kind, start, len) {
      var t = 0, map = byDay[kind] || {};
      for (var i = 0; i < len; i++) t += map[Store.addDays(start, i)] || 0;
      return t;
    }
    function seriesOf(kind, start, len) {
      var out = [], map = byDay[kind] || {};
      for (var i = 0; i < len; i++) out.push(map[Store.addDays(start, i)] || 0);
      return out;
    }

    function render() {
      Array.prototype.forEach.call(el.querySelectorAll('[data-range]'), function (b) {
        var on = b.dataset.range === range;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      var R0 = RANGES.filter(function (r) { return r.k === range; })[0];
      sub.textContent = R0.sub ? R0.sub + ', בהשוואה לתקופה שלפניה' : 'מהבוקר עד עכשיו';
      if (!loaded) return;
      var len = R0.days, start = Store.addDays(today, -(len - 1)), prevStart = Store.addDays(start, -len);
      var isToday = range === 'today';

      var cards = METRICS.map(function (mt) {
        var cur = sumDays(mt.k, start, len);
        var prev = sumDays(mt.k, prevStart, len);
        return '<div class="ed-stat">' +
          '<div class="ed-stat-head"><span class="ed-stat-icon" aria-hidden="true">' + mt.icon + '</span><span>' + mt.label + '</span></div>' +
          '<div class="ed-stat-num"><b>' + cur + '</b>' + (isToday ? '' : changeHTML(cur, prev)) + '</div>' +
          (isToday ? '' : sparkSVG(seriesOf(mt.k, start, len), mt.label + ' לפי ימים')) +
        '</div>';
      }).join('');

      /* דירוגים לפי מנה בתקופה */
      var inRange = votes.filter(function (v) { var d = voteDay(v); return d >= start && d <= today; });
      var per = {};
      inRange.forEach(function (v) {
        var x = per[v.dish_id] || (per[v.dish_id] = { n: 0, sum: 0, c: 0 });
        x.n++; x.sum += v.score; if (v.comment) x.c++;
      });
      var names = {};
      S.dishes.forEach(function (d) { names[d.id] = d.name; });
      var rows = Object.keys(per).filter(function (k) { return names[k]; }).map(function (k) {
        return { id: k, name: names[k], n: per[k].n, avg: per[k].sum / per[k].n, c: per[k].c };
      }).sort(function (a, b) { return (b.avg - a.avg) || (b.n - a.n); });
      var table = rows.length
        ? '<div class="ed-dish-rates">' + rows.map(function (r) {
            return '<button type="button" class="ed-dish-rate" data-rates="' + esc(r.id) + '">' +
              '<span class="ed-dish-rate-name">' + esc(r.name) + '</span>' +
              '<span>' + App.FACES[Math.max(0, Math.min(4, Math.round(r.avg) - 1))] + ' ' + r.avg.toFixed(1) + '</span>' +
              '<span class="ed-dish-rate-n">' + r.n + ' דירוגים' + (r.c ? ' · 💬 ' + r.c : '') + '</span></button>';
          }).join('') + '</div>'
        : '<p class="ed-ovr-empty">אין דירוגי מנות בתקופה הזו.</p>';

      dash.innerHTML = '<div class="ed-stats">' + cards + '</div>' +
        '<h3 class="ed-sub">דירוגי המנות בתקופה</h3>' + table;
    }
    render();

    Store.loadEventDays(from).then(function (rows) {
      rows.forEach(function (r) {
        var map = byDay[r.kind] || (byDay[r.kind] = {});
        map[String(r.day).slice(0, 10)] = (map[String(r.day).slice(0, 10)] || 0) + Number(r.n || 0);
      });
      var vmap = byDay.votes = {};
      votes.forEach(function (v) { var d = voteDay(v); vmap[d] = (vmap[d] || 0) + 1; });
      loaded = true;
      render();
    }, function (er) { m.close(); fail(er, 'לטעון את הנתונים'); });

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.range) { range = t.dataset.range; render(); return; }
      if (t.dataset.act === 'cancel') m.close();
    });
  }

  /* ======================================================================
     ביקורת חדשה מצילום מסך של גוגל (Gemini קורא, הבעלים מאשר)
     ====================================================================== */
  var SHOT_ERRORS = {
    no_key: 'קריאה אוטומטית עוד לא הופעלה (חסר מפתח Gemini). אפשר למלא את הפרטים ידנית.',
    bad_key: 'מפתח ה-Gemini לא תקין. אפשר למלא את הפרטים ידנית.',
    quota: 'Gemini עמוס כרגע (מכסה חינמית). נסו שוב בעוד דקה, או מלאו ידנית.',
    unreadable: 'לא הצלחנו לקרוא את התמונה. נסו צילום ברור יותר, או מלאו ידנית.',
    not_owner: 'אין הרשאה. צריך להיכנס שוב.',
    network: 'לא הצלחנו לקרוא את התמונה. בדקו אינטרנט, או מלאו ידנית.'
  };

  function openShotForm() {
    var stars = 5, busy = false;
    var m = openModal(
      '<form class="ed-form" novalidate>' +
        '<h2 class="ed-title">📷 ביקורת מצילום מסך</h2>' +
        '<p class="ed-text">צלמו מסך של ביקורת בגוגל מפות ובחרו אותו כאן. הפרטים יתמלאו לבד. בדקו אותם, ורק אחרי "אישור" הביקורת עולה לאתר.</p>' +
        '<div class="ed-field"><div class="ed-photo ed-photo-wide">' +
          '<div class="ed-photo-preview ed-photo-rect ed-shot-preview" data-preview><span>אין תמונה</span></div>' +
          '<div class="ed-photo-btns"><button type="button" class="ed-btn ed-btn-secondary" data-act="pick">📷 בחר צילום מסך</button></div>' +
          '<input type="file" accept="image/*" hidden>' +
        '</div></div>' +
        '<p class="ed-shot-status" role="status" aria-live="polite" hidden></p>' +
        '<div class="ed-shot-fields" hidden>' +
          '<label class="ed-field"><span class="ed-label">שם הכותב</span>' +
            '<input class="ed-input" name="author" type="text" maxlength="60" autocomplete="off"></label>' +
          '<div class="ed-field"><span class="ed-label">כוכבים</span>' +
            '<div class="ed-stars" role="radiogroup" aria-label="כוכבים">' +
              [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="ed-star" data-n="' + n + '" role="radio" aria-label="' + n + ' כוכבים">★</button>'; }).join('') +
            '</div></div>' +
          '<label class="ed-field"><span class="ed-label">מה נכתב בביקורת</span>' +
            '<textarea class="ed-input ed-textarea" name="text" rows="6" maxlength="2000"></textarea></label>' +
          '<label class="ed-field"><span class="ed-label">קישור לביקורת בגוגל מפות <small>(לא חובה)</small></span>' +
            '<input class="ed-input" name="url" type="url" inputmode="url" dir="ltr" maxlength="500" autocomplete="off" placeholder="https://maps.app.goo.gl/..."></label>' +
        '</div>' +
        '<p class="ed-error" role="alert" hidden></p>' +
        '<div class="ed-actions">' +
          '<button type="submit" class="ed-btn ed-btn-primary" hidden>✅ אישור ופרסום</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
        '</div>' +
      '</form>', 'ed-modal-form');
    var el = m.el, form = $(el, 'form'), err = $(el, '.ed-error');
    var fileIn = $(el, 'input[type=file]'), preview = $(el, '[data-preview]');
    var status = $(el, '.ed-shot-status'), fields = $(el, '.ed-shot-fields'), ok = $(el, '.ed-btn-primary');
    var previewURL = null;
    m.onClose = function () { if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch (e) {} } };

    function refreshStars() {
      Array.prototype.forEach.call(el.querySelectorAll('.ed-star'), function (b) {
        b.classList.toggle('is-on', Number(b.dataset.n) <= stars);
        b.setAttribute('aria-checked', Number(b.dataset.n) === stars ? 'true' : 'false');
      });
    }
    function say(t, kind) {
      status.textContent = t; status.hidden = !t;
      status.className = 'ed-shot-status' + (kind ? ' is-' + kind : '');
    }
    function showFields() { fields.hidden = false; ok.hidden = false; refreshStars(); }

    fileIn.addEventListener('change', function () {
      var file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file || busy) return;
      err.hidden = true;
      busy = true;
      say('⏳ קורא את הביקורת…', 'busy');
      resizeImage(file, 1600, 0.9).then(function (blob) {
        if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch (e) {} }
        previewURL = URL.createObjectURL(blob);
        preview.innerHTML = '<img alt="" src="' + esc(previewURL) + '">';
        $(el, '[data-act=pick]').textContent = '📷 צילום אחר';
        return Store.readReview(blob);
      }).then(function (r) {
        form.elements.author.value = r.author || '';
        form.elements.text.value = r.text || '';
        stars = r.stars || 5;
        say('✓ נקרא. בדקו שהכול נכון ואשרו.', 'ok');
        showFields();
      }, function (er) {
        if (er && er.auth) { fail(er); return; }
        say(SHOT_ERRORS[er && er.code] || (er && er.message) || SHOT_ERRORS.network, 'warn');
        showFields();
      }).then(function () { busy = false; });
    });

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.n) { stars = Number(t.dataset.n); refreshStars(); return; }
      if (t.dataset.act === 'pick') fileIn.click();
      else if (t.dataset.act === 'cancel') m.close();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var text = form.elements.text.value.trim();
      if (!text) { err.textContent = 'חסר הטקסט של הביקורת'; err.hidden = false; form.elements.text.focus(); return; }
      var url = form.elements.url.value.trim();
      if (url && !/^https?:\/\//i.test(url)) { err.textContent = 'הקישור צריך להתחיל ב-https://'; err.hidden = false; return; }
      var sorts = S.reviews.map(function (x) { return x.sort || 0; });
      var out = {
        id: null, author: form.elements.author.value.trim(), text: text, stars: stars, source: 'גוגל', url: url,
        sort: Math.max.apply(null, sorts.concat([0])) + 1, visible: true, from_screenshot: true
      };
      ok.disabled = true; ok.textContent = 'מפרסם…';
      Store.saveReview(out).then(function (saved) {
        S.reviews.push(saved);
        sortReviews();
        App.renderReviews();
        m.close();
        flash(saved.id);
        toast('הביקורת פורסמה באתר ✓');
      }, function (er) { ok.disabled = false; ok.textContent = '✅ אישור ופרסום'; fail(er, 'לשמור'); });
    });
  }

  function buildChrome() {
    removeChrome();
    var r = doc.createElement('div');
    r.className = 'ed-ribbon';
    var html = '<div class="ed-ribbon-main"><strong>✏️ מצב עריכה</strong> ' +
      'לחץ על העיפרון ליד כל מנה כדי לשנות אותה, או על "הוסף מנה". כל שינוי מופיע באתר מיד.</div>';
    if (S.offline) {
      html += '<div class="ed-ribbon-note is-warn">לא הצלחנו להתחבר לשרת, ושינויים לא יישמרו. ' +
        '<button type="button" class="ed-link" data-bar="retry">נסה שוב</button></div>';
    }
    if (S.empty && Store.live) {
      html += '<div class="ed-ribbon-note is-warn">מסד הנתונים עדיין ריק. ' +
        '<button type="button" class="ed-btn ed-btn-secondary" data-bar="import">ייבא את התפריט הקיים</button></div>';
    }
    r.innerHTML = html;
    var host = doc.getElementById('menu');
    if (host) host.insertBefore(r, host.firstChild); else doc.body.insertBefore(r, doc.body.firstChild);

    var b = doc.createElement('div');
    b.className = 'ed-bar';
    b.innerHTML =
      '<button type="button" class="ed-bar-btn ed-bar-main" data-bar="add"><span>➕</span> הוסף מנה</button>' +
      '<button type="button" class="ed-bar-btn" data-bar="popup"><span>📢</span> הודעה קופצת</button>' +
      '<button type="button" class="ed-bar-btn" data-bar="hours"><span>🕐</span> שעות פתיחה</button>' +
      '<button type="button" class="ed-bar-btn" data-bar="feedback"><span>💬</span> משוב<i class="ed-badge" hidden></i></button>' +
      '<button type="button" class="ed-bar-btn" data-bar="stats"><span>📊</span> נתונים</button>' +
      '<button type="button" class="ed-bar-btn ed-bar-exit" data-bar="exit"><span>🚪</span> יציאה</button>';
    doc.body.appendChild(b);
    chrome.ribbon = r; chrome.bar = b;
    refreshFeedbackBadge();
  }

  function removeChrome() {
    ['ribbon', 'bar'].forEach(function (k) {
      if (chrome[k] && chrome[k].parentNode) chrome[k].parentNode.removeChild(chrome[k]);
      chrome[k] = null;
    });
  }

  function defaultCat() {
    var f = App.getFilter();
    return (f === 'hummus' || f === 'grill' || f === 'sides' || f === 'drinks') ? f : 'grill';
  }

  function onDocClick(e) {
    if (!inEdit) return;
    var t = e.target.closest ? e.target.closest('[data-edit],[data-add],[data-edit-fillings],[data-edit-review],[data-add-shot],[data-rates],[data-bar]') : null;
    if (!t) return;
    if (t.hasAttribute('data-rates')) {
      openRatings(t.getAttribute('data-rates'));
    } else if (t.hasAttribute('data-add-shot')) {
      openShotForm();
    } else if (t.hasAttribute('data-edit-review')) {
      var rid = t.getAttribute('data-edit-review');
      var rv = S.reviews.filter(function (x) { return x.id === rid; })[0];
      if (rv) openReviewView(rv);
    } else if (t.hasAttribute('data-edit')) {
      var id = t.getAttribute('data-edit');
      var d = S.dishes.filter(function (x) { return x.id === id; })[0];
      if (d) openDishForm(d);
    } else if (t.hasAttribute('data-edit-fillings')) {
      openFillingsForm();
    } else if (t.hasAttribute('data-add')) {
      var kind = t.getAttribute('data-add');
      if (kind === 'special') openDishForm(null, { cat: 'grill', special_date: Store.todayIL() });
      else openDishForm(null, { cat: kind === 'main' ? (App.getFilter() === 'hummus' ? 'hummus' : 'grill') : kind });
    } else {
      var act = t.getAttribute('data-bar');
      if (act === 'add') {
        if (App.getFilter() === 'specials') openDishForm(null, { cat: 'grill', special_date: Store.todayIL() });
        else openDishForm(null, { cat: defaultCat() });
      }
      else if (act === 'popup') openPopupForm();
      else if (act === 'hours') openHoursForm();
      else if (act === 'feedback') openFeedbackList();
      else if (act === 'stats') openDashboard();
      else if (act === 'exit') {
        Store.logout();
        if (CFG.gateAll) { global.location.reload(); return; }   // אתר פרטי: חוזרים למסך השחור
        exit(); toast('יצאת ממצב העריכה');
      }
      else if (act === 'retry') App.reload().then(function () { S.offline = false; buildChrome(); App.render(); });
      else if (act === 'import') {
        t.disabled = true; t.textContent = 'מייבא…';
        Store.importSeed().then(function () { return App.reload(); }).then(function () {
          buildChrome(); App.render(); toast('התפריט יובא ✓');
        }, function (er) { t.disabled = false; t.textContent = 'ייבא את התפריט הקיים'; fail(er, 'לייבא'); });
      }
    }
  }

  /* ======================================================================
     כניסה ויציאה ממצב עריכה
     ====================================================================== */
  function enter() {
    if (inEdit) return;
    inEdit = true;
    S.edit = true;
    doc.body.classList.add('ed-on');
    App.closePopup();
    buildChrome();
    App.render();
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('change', onSoldOutChange);
    loadVotes();
    setTimeout(scrollToRibbon, 0);
  }

  function scrollToRibbon() {
    var t = chrome.ribbon || doc.getElementById('menu');
    if (!t) return;
    var y = Math.max(0, t.getBoundingClientRect().top + (global.pageYOffset || 0) - 78);
    try { global.scrollTo({ top: y, behavior: 'instant' }); } catch (e) { global.scrollTo(0, y); }
  }

  function exit() {
    inEdit = false;
    S.edit = false;
    doc.body.classList.remove('ed-on');
    doc.removeEventListener('click', onDocClick);
    doc.removeEventListener('change', onSoldOutChange);
    removeChrome();
    var overlays = doc.querySelectorAll('.ed-overlay');
    Array.prototype.forEach.call(overlays, function (o) { o.parentNode.removeChild(o); });
    doc.body.classList.remove('ed-lock');
    App.render();
    try {
      var u = new URL(global.location.href);
      u.searchParams.delete('edit');
      if (u.hash === '#edit') u.hash = '';
      global.history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  function start(appRef) {
    if (appRef) { App = appRef; Store = App.Store; S = App.state; }
    if (inEdit) return Promise.resolve();
    function ask() {
      return loginDialog().then(function (loggedIn) {
        if (loggedIn) { enter(); return; }
        if (CFG.gateAll) return ask();   // אתר פרטי: חייבים להתחבר
      });
    }
    return Store.checkSession().then(function (ok) {
      if (ok) { enter(); return; }
      return ask();
    });
  }

  global.KababiaAdmin = { start: start, exit: exit };
})(window);
