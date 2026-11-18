/* admin.js - מצב עריכה לבעל העסק.
   נטען רק כשמבקשים עריכה (לחיצה על המנעול בתחתית האתר, או ?edit=1 בכתובת).
   העריכה נעשית על האתר עצמו, בדיוק כמו שהלקוחות רואים אותו:
   עיפרון ליד כל מנה, כפתור "הוסף מנה", הודעה קופצת, וסלטים/רטבים. */
(function (global) {
  'use strict';

  var doc = document;
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
  function openModal(html, cls) {
    var ov = doc.createElement('div');
    ov.className = 'ed-overlay';
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
    function onKey(e) {
      var top = doc.querySelectorAll('.ed-overlay');
      if (e.key === 'Escape' && top[top.length - 1] === ov) api.close();
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
      try { saved = global.localStorage.getItem('kababia.email') || ''; } catch (e) {}
      var m = openModal(
        '<form class="ed-form" novalidate>' +
          '<h2 class="ed-title">🔒 כניסה לעריכת האתר</h2>' +
          (live ? '' : '<p class="ed-note">מצב הדגמה: כל אימייל מתאים, והסיסמה היא <b>' + esc(Store.demoPassword) + '</b></p>') +
          '<label class="ed-field"><span class="ed-label">אימייל</span>' +
            '<input class="ed-input" name="email" type="email" autocomplete="username" inputmode="email" dir="ltr"></label>' +
          '<label class="ed-field"><span class="ed-label">סיסמה</span>' +
            '<input class="ed-input" name="password" type="password" autocomplete="current-password" dir="ltr"></label>' +
          '<p class="ed-error" role="alert" hidden></p>' +
          '<div class="ed-actions">' +
            '<button type="submit" class="ed-btn ed-btn-primary">כניסה</button>' +
            '<button type="button" class="ed-btn ed-btn-ghost" data-cancel>ביטול</button>' +
          '</div>' +
        '</form>', 'ed-modal-small');
      var form = $(m.el, 'form');
      var email = form.elements.email, pass = form.elements.password;
      var err = $(m.el, '.ed-error');
      var done = false;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      email.value = saved || (live ? '' : 'owner@demo');
      setTimeout(function () { (email.value ? pass : email).focus(); }, 50);
      m.onClose = function () { finish(false); };
      $(m.el, '[data-cancel]').addEventListener('click', function () { finish(false); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.hidden = true;
        var btn = $(m.el, '.ed-btn-primary');
        btn.disabled = true; btn.textContent = 'נכנס…';
        Store.login(email.value.trim(), pass.value).then(function () {
          try { global.localStorage.setItem('kababia.email', email.value.trim()); } catch (x) {}
          finish(true);
        }, function (er) {
          btn.disabled = false; btn.textContent = 'כניסה';
          err.textContent = er && er.badCredentials ? 'האימייל או הסיסמה לא נכונים' : 'לא הצלחנו להתחבר. בדוק חיבור לאינטרנט ונסה שוב.';
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
  function openReviewForm(review) {
    var isNew = !review;
    var base = review ? clone(review) : { id: null, author: '', text: '', stars: 5, source: '', sort: 0, visible: true };
    var stars = base.stars || 5;
    var m = openModal(
      '<form class="ed-form" novalidate>' +
        '<h2 class="ed-title">' + (isNew ? '➕ חוות דעת חדשה' : '✏️ עריכת חוות דעת') + '</h2>' +
        '<p class="ed-text">אפשר להעתיק לכאן ביקורת אמיתית של לקוח, למשל מגוגל.</p>' +
        '<label class="ed-field"><span class="ed-label">מה הלקוח כתב?</span>' +
          '<textarea class="ed-input ed-textarea" name="text" rows="5" maxlength="500" placeholder="לדוגמה: הקבב הכי טעים באזור, שירות מעולה!"></textarea></label>' +
        '<label class="ed-field"><span class="ed-label">שם הלקוח</span>' +
          '<input class="ed-input" name="author" type="text" maxlength="60" autocomplete="off" placeholder="לדוגמה: דני כהן"></label>' +
        '<div class="ed-field"><span class="ed-label">כמה כוכבים נתן?</span>' +
          '<div class="ed-stars" role="radiogroup" aria-label="כוכבים">' +
            [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="ed-star" data-n="' + n + '" role="radio" aria-label="' + n + ' כוכבים">★</button>'; }).join('') +
          '</div></div>' +
        '<div class="ed-field"><span class="ed-label">מאיפה? <small>(לא חובה)</small></span>' +
          '<input class="ed-input" name="source" type="text" maxlength="30" autocomplete="off" placeholder="לדוגמה: גוגל">' +
          '<div class="ed-date-quick ed-source-quick">' +
            ['גוגל', 'אינסטגרם', 'פייסבוק', 'וואטסאפ'].map(function (n) { return '<button type="button" class="ed-chip" data-source="' + n + '">' + n + '</button>'; }).join('') +
          '</div></div>' +
        '<label class="ed-field"><span class="ed-label">קישור לביקורת בגוגל מפות <small>(לא חובה)</small></span>' +
          '<input class="ed-input" name="url" type="url" inputmode="url" dir="ltr" maxlength="500" autocomplete="off" placeholder="https://maps.app.goo.gl/...">' +
          '<small class="ed-hint">איך מקבלים? בגוגל מפות, ליד הביקורת לוחצים על שלוש הנקודות ← "שתף ביקורת" ← "העתק קישור", ומדביקים כאן. הלקוחות יראו כפתור שמוביל לביקורת המקורית.</small></label>' +
        '<label class="ed-switch"><input type="checkbox" name="on"><span class="ed-switch-ui"></span><span>להציג באתר</span></label>' +
        '<p class="ed-error" role="alert" hidden></p>' +
        '<div class="ed-actions">' +
          '<button type="submit" class="ed-btn ed-btn-primary">💾 שמור</button>' +
          '<button type="button" class="ed-btn ed-btn-ghost" data-act="cancel">ביטול</button>' +
        '</div>' +
        (isNew ? '' :
          '<div class="ed-more">' +
            '<button type="button" class="ed-btn ed-btn-ghost" data-act="up">⬆ הזז למעלה</button>' +
            '<button type="button" class="ed-btn ed-btn-ghost" data-act="down">⬇ הזז למטה</button>' +
            '<button type="button" class="ed-btn ed-btn-danger" data-act="delete">🗑 מחק</button>' +
          '</div>') +
      '</form>', 'ed-modal-form');
    var el = m.el, form = $(el, 'form'), err = $(el, '.ed-error');
    form.elements.text.value = base.text;
    form.elements.author.value = base.author;
    form.elements.source.value = base.source;
    form.elements.url.value = base.url || '';
    form.elements.on.checked = base.visible !== false;

    function refreshStars() {
      Array.prototype.forEach.call(el.querySelectorAll('.ed-star'), function (b) {
        var on = Number(b.dataset.n) <= stars;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', Number(b.dataset.n) === stars ? 'true' : 'false');
      });
    }
    refreshStars();

    el.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.n) { stars = Number(t.dataset.n); refreshStars(); return; }
      if (t.dataset.source) { form.elements.source.value = t.dataset.source; return; }
      switch (t.dataset.act) {
        case 'cancel': m.close(); break;
        case 'delete': deleteReview(review).then(function (ok) { if (ok) m.close(); }); break;
        case 'up': moveReview(review, -1).then(function (ok) { if (ok) m.close(); }); break;
        case 'down': moveReview(review, 1).then(function (ok) { if (ok) m.close(); }); break;
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var text = form.elements.text.value.trim();
      if (!text) {
        err.textContent = 'חסר הטקסט של חוות הדעת'; err.hidden = false;
        form.elements.text.focus();
        return;
      }
      var url = form.elements.url.value.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        err.textContent = 'הקישור צריך להתחיל ב-https://'; err.hidden = false;
        form.elements.url.focus();
        return;
      }
      var sorts = S.reviews.map(function (x) { return x.sort || 0; });
      var out = clone(base);
      out.url = url;
      out.text = text;
      out.author = form.elements.author.value.trim();
      out.source = form.elements.source.value.trim();
      out.stars = stars;
      out.visible = form.elements.on.checked;
      if (isNew) out.sort = Math.max.apply(null, sorts.concat([0])) + 1;
      var btn = $(el, '.ed-btn-primary');
      btn.disabled = true; btn.textContent = 'שומר…';
      Store.saveReview(out).then(function (saved) {
        var idx = -1;
        S.reviews.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
        if (idx >= 0) S.reviews[idx] = saved; else S.reviews.push(saved);
        sortReviews();
        App.renderReviews();
        m.close();
        flash(saved.id);
        toast(isNew ? 'חוות הדעת נוספה ✓' : 'נשמר ✓');
      }, function (er) { btn.disabled = false; btn.textContent = '💾 שמור'; fail(er, 'לשמור'); });
    });
    setTimeout(function () { if (isNew) form.elements.text.focus(); }, 60);
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
  function buildChrome() {
    removeChrome();
    var r = doc.createElement('div');
    r.className = 'ed-ribbon';
    var html = '<div class="ed-ribbon-main"><strong>✏️ מצב עריכה</strong> ' +
      'לחץ על העיפרון ליד כל מנה כדי לשנות אותה, או על "הוסף מנה". כל שינוי מופיע באתר מיד.</div>';
    if (!Store.live) {
      html += '<div class="ed-ribbon-note">מצב הדגמה: השינויים נשמרים רק בדפדפן הזה ולא באתר האמיתי. ' +
        '<button type="button" class="ed-link" data-bar="reset">איפוס להדגמה</button></div>';
    }
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
      '<button type="button" class="ed-bar-btn ed-bar-exit" data-bar="exit"><span>🚪</span> יציאה</button>';
    doc.body.appendChild(b);
    chrome.ribbon = r; chrome.bar = b;
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
    var t = e.target.closest ? e.target.closest('[data-edit],[data-add],[data-edit-fillings],[data-edit-review],[data-add-review],[data-bar]') : null;
    if (!t) return;
    if (t.hasAttribute('data-edit-review')) {
      var rid = t.getAttribute('data-edit-review');
      var rv = S.reviews.filter(function (x) { return x.id === rid; })[0];
      if (rv) openReviewForm(rv);
    } else if (t.hasAttribute('data-add-review')) {
      openReviewForm(null);
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
      else if (act === 'exit') { Store.logout(); exit(); toast('יצאת ממצב העריכה'); }
      else if (act === 'retry') App.reload().then(function () { S.offline = false; buildChrome(); App.render(); });
      else if (act === 'import') {
        t.disabled = true; t.textContent = 'מייבא…';
        Store.importSeed().then(function () { return App.reload(); }).then(function () {
          buildChrome(); App.render(); toast('התפריט יובא ✓');
        }, function (er) { t.disabled = false; t.textContent = 'ייבא את התפריט הקיים'; fail(er, 'לייבא'); });
      } else if (act === 'reset') {
        confirmDialog({ title: 'לאפס את ההדגמה?', text: 'כל השינויים שעשית בדפדפן הזה יימחקו והתפריט יחזור למקור.', ok: 'כן, אפס', danger: true })
          .then(function (yes) { if (yes) { Store.resetDemo(); global.location.reload(); } });
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
    return Store.checkSession().then(function (ok) {
      if (ok) { enter(); return; }
      return loginDialog().then(function (loggedIn) { if (loggedIn) enter(); });
    });
  }

  global.KababiaAdmin = { start: start, exit: exit };
})(window);
