/* menu.js - מצייר את התפריט מהנתונים, מציג הודעה קופצת,
   וטוען את מצב העריכה (admin.js) רק כשבעל העסק מבקש.
   אם משהו נכשל, נשאר התפריט הסטטי שכתוב ב-HTML. */
(function (global) {
  'use strict';

  var Store = global.KababiaStore;
  var doc = document;
  var bodyEl = doc.getElementById('menu-body');
  if (!Store || !bodyEl) return;

  var state = {
    dishes: Store.seedDishes(),
    settings: Store.defaultSettings(),
    edit: false,
    empty: false,
    offline: false
  };
  var currentFilter = 'all';
  var lastSignature = '';
  var rendered = false;

  /* ---------- עזרים ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtPrice(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return /^\d+([.,]\d+)?$/.test(s) ? s.replace(',', '.') + ' ₪' : s;
  }

  function cleanNote(n) {
    return String(n || '').trim().replace(/^\(+\s*/, '').replace(/\s*\)+$/, '');
  }

  function splitItems(text) {
    return String(text || '').split(/[·\n,،]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function isShownPublic(d, today) {
    return d.visible !== false && (!d.special_date || d.special_date === today);
  }

  function dateLabel(date, today) {
    if (date === today) return 'היום בלבד';
    if (date === Store.addDays(today, 1)) return 'מחר בלבד';
    var p = date.split('-');
    return 'ב-' + p[2] + '.' + p[1] + ' בלבד';
  }

  /* ---------- אייקוני תמונה חסרה (כמו שהיה באתר) ---------- */
  var ICONS = {
    hummus: '<path d="M4 11a8 8 0 0 1 16 0v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1zm-1 4h18v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2z"/>',
    falafel: '<circle cx="7" cy="8" r="2.4"/><circle cx="13" cy="6.5" r="2.4"/><circle cx="17.5" cy="10.5" r="2.4"/><circle cx="9" cy="13.5" r="2.4"/><circle cx="14.5" cy="15" r="2.4"/>',
    kabab: '<path d="M4 3c-.55 0-1 .45-1 1s.45 1 1 1h1v11a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V5h1c.55 0 1-.45 1-1s-.45-1-1-1H4zm4 4h2v9H8V7zm4 0h2v9h-2V7zm4 0h2v9h-2V7z"/>',
    generic: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/>'
  };
  ICONS.entrecote = ICONS.kabab;

  function placeholderKey(d) {
    if (d.placeholder && ICONS[d.placeholder]) return d.placeholder;
    return d.cat === 'hummus' ? 'hummus' : (d.cat === 'grill' ? 'kabab' : 'generic');
  }

  /* ---------- בניית ה-HTML (אותם מחלקות כמו באתר המקורי) ---------- */
  var PENCIL_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

  function pencil(attr, label) {
    return '<button type="button" class="ed-pencil" ' + attr + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' + PENCIL_SVG + '</button>';
  }

  function tagHTML(d, today, ed) {
    if (ed && d.visible === false) return '<span class="dish-tag is-off">מוסתרת</span>';
    if (d.special_date) {
      if (d.special_date < today) return ed ? '<span class="dish-tag is-expired">פג תוקף</span>' : '';
      return '<span class="dish-tag is-temp">' + esc(dateLabel(d.special_date, today)) + '</span>';
    }
    return '';
  }

  function pricesHTML(d) {
    var ps = (d.prices || []).filter(function (x) { return String(x.price).trim() !== ''; });
    if (!ps.length) return '';
    if (ps.length === 1 && !ps[0].label) {
      return '<span class="price">' + esc(fmtPrice(ps[0].price)) + '</span>';
    }
    return '<ul class="price-options">' + ps.map(function (x) {
      return '<li>' + (x.label ? esc(x.label) + ' ' : '') + '<span class="price">' + esc(fmtPrice(x.price)) + '</span></li>';
    }).join('') + '</ul>';
  }

  function dishHTML(d, today, ed) {
    var shown = isShownPublic(d, today);
    var img;
    if (d.image) {
      img = '<img src="' + esc(d.image) + '" alt="' + esc(d.name) + '" loading="lazy" class="menu-dish-img">';
    } else {
      var ph = placeholderKey(d);
      img = '<div class="menu-dish-img placeholder placeholder-' + ph + '" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">' + ICONS[ph] + '</svg></div>';
    }
    var note = cleanNote(d.note);
    return '<div class="menu-dish' + (ed && !shown ? ' is-off' : '') + '" data-cat="' + esc(d.cat) + '" data-id="' + esc(d.id) + '">' +
      img +
      '<div class="menu-dish-info">' +
        tagHTML(d, today, ed) +
        '<span class="menu-dish-name">' + esc(d.name) + (note ? ' <em>(' + esc(note) + ')</em>' : '') + '</span>' +
        pricesHTML(d) +
      '</div>' +
      (ed ? pencil('data-edit="' + esc(d.id) + '"', 'עריכת המנה ' + d.name) : '') +
    '</div>';
  }

  function liHTML(d, today, ed) {
    var shown = isShownPublic(d, today);
    var ps = (d.prices || []).filter(function (x) { return String(x.price).trim() !== ''; });
    var priceText = ps.map(function (x) { return (x.label ? x.label + ' ' : '') + fmtPrice(x.price); }).join(' · ');
    var note = cleanNote(d.note);
    var tag = tagHTML(d, today, ed);
    var left = '<span class="price">' + esc(priceText) + '</span>';
    return '<li class="' + (ed && !shown ? 'is-off' : '') + '" data-id="' + esc(d.id) + '">' +
      '<span>' + tag + esc(d.name) + (note ? ' <em>(' + esc(note) + ')</em>' : '') + '</span>' +
      (ed ? '<span class="ed-li-end">' + left + pencil('data-edit="' + esc(d.id) + '"', 'עריכת ' + d.name) + '</span>' : left) +
    '</li>';
  }

  function render() {
    var today = Store.todayIL();
    var ed = state.edit;
    var list = state.dishes.filter(function (d) { return ed || isShownPublic(d, today); });
    var main = list.filter(function (d) { return d.cat === 'grill' || d.cat === 'hummus'; });
    var sides = list.filter(function (d) { return d.cat === 'sides'; });
    var drinks = list.filter(function (d) { return d.cat === 'drinks'; });
    var html = '';

    if (main.length || ed) {
      html += '<div class="menu-group menu-group-main" data-cat="grill hummus"><h3>מנות עיקריות</h3>' +
        '<div class="menu-dish-list">' +
        main.map(function (d) { return dishHTML(d, today, ed); }).join('') +
        (ed ? '<button type="button" class="ed-add-tile" data-add="main"><span>＋</span> הוסף מנה</button>' : '') +
        '</div></div>';
    }

    var salads = splitItems(state.settings.salads).join(' · ');
    var sauces = splitItems(state.settings.sauces).join(' · ');
    html += '<div class="fillings" data-cat="grill hummus">' +
      '<p class="fillings-lead"><span class="fillings-icon" aria-hidden="true">🥗</span> ' +
      'כל מנה בפיתה או בבגט &mdash; אתם בוחרים מה נכנס פנימה, ללא תוספת תשלום</p>' +
      '<div class="fillings-cols">' +
        '<div class="fillings-col"><h4>סלטים</h4><p class="menu-tags">' + esc(salads) + '</p></div>' +
        '<div class="fillings-col"><h4>רטבים</h4><p class="menu-tags">' + esc(sauces) + '</p></div>' +
      '</div>' +
      (ed ? pencil('data-edit-fillings', 'עריכת הסלטים והרטבים') : '') +
    '</div>';

    function listGroup(cat, title, items, addLabel) {
      if (!items.length && !ed) return '';
      return '<div class="menu-group" data-cat="' + cat + '"><h3>' + title + '</h3><ul class="menu-list">' +
        items.map(function (d) { return liHTML(d, today, ed); }).join('') +
        (ed ? '<li class="ed-add-li"><button type="button" class="ed-add-tile ed-add-small" data-add="' + cat + '"><span>＋</span> ' + addLabel + '</button></li>' : '') +
        '</ul></div>';
    }
    var groups = listGroup('sides', 'תוספות', sides, 'הוסף תוספת') + listGroup('drinks', 'שתייה', drinks, 'הוסף שתייה');
    if (groups) html += '<div class="menu-groups">' + groups + '</div>';

    bodyEl.innerHTML = html;
    rendered = true;
    applyFilter(currentFilter);
  }

  /* ---------- טאבים (סינון קטגוריות) ---------- */
  function matches(el, filter) {
    return filter === 'all' || String(el.getAttribute('data-cat') || '').split(' ').indexOf(filter) !== -1;
  }

  function applyFilter(filter) {
    currentFilter = filter || currentFilter;
    var f = currentFilter;
    Array.prototype.forEach.call(bodyEl.querySelectorAll('.menu-dish'), function (dish) {
      dish.hidden = !matches(dish, f);
    });
    Array.prototype.forEach.call(bodyEl.querySelectorAll('.menu-group[data-cat], .fillings[data-cat]'), function (group) {
      var own = matches(group, f);
      var listEl = group.querySelector('.menu-dish-list');
      if (listEl && !state.edit) {
        own = Array.prototype.some.call(listEl.querySelectorAll('.menu-dish'), function (d) { return !d.hidden; });
      }
      group.hidden = !own;
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.menu-tab'), function (tab) {
      var on = tab.getAttribute('data-filter') === f;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  doc.addEventListener('click', function (e) {
    var tab = e.target.closest ? e.target.closest('.menu-tab') : null;
    if (tab) applyFilter(tab.getAttribute('data-filter'));
  });

  /* ---------- הודעה קופצת ללקוחות ---------- */
  function hashText(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return String(h);
  }

  function closePopup() {
    var el = doc.querySelector('.site-popup');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    doc.body.classList.remove('popup-open');
    doc.removeEventListener('keydown', onPopupKey);
  }
  function onPopupKey(e) { if (e.key === 'Escape') closePopup(); }

  function openPopup(text) {
    closePopup();
    var el = doc.createElement('div');
    el.className = 'site-popup';
    el.innerHTML =
      '<div class="site-popup-card" role="dialog" aria-modal="true" aria-label="הודעה מהקבביה">' +
        '<img class="site-popup-logo" src="images/logo.jpg" alt="">' +
        '<p class="site-popup-text"></p>' +
        '<button type="button" class="btn btn-whatsapp site-popup-close">הבנתי</button>' +
      '</div>';
    el.querySelector('.site-popup-text').textContent = text;
    el.addEventListener('click', function (e) { if (e.target === el) closePopup(); });
    el.querySelector('.site-popup-close').addEventListener('click', closePopup);
    doc.body.appendChild(el);
    doc.body.classList.add('popup-open');
    doc.addEventListener('keydown', onPopupKey);
    try { el.querySelector('.site-popup-close').focus(); } catch (err) {}
  }

  function maybeShowPopup(force) {
    var s = state.settings;
    var text = String(s.popup_text || '').trim();
    if (!text) return;
    if (!force) {
      if (!s.popup_enabled) return;
      if (s.popup_until && s.popup_until < Store.todayIL()) return;
      var key = 'kababia.popup.' + hashText(text);
      try {
        if (global.sessionStorage.getItem(key)) return;
        global.sessionStorage.setItem(key, '1');
      } catch (e) {}
    }
    openPopup(text);
  }

  /* ---------- טעינת הנתונים ---------- */
  function signature(d) { return JSON.stringify([d.dishes, d.settings]); }

  function applyData(d) {
    if (!d.dishes.length) {
      // מסד ריק: משאירים את התפריט הסטטי שב-HTML (ובעריכה אפשר לייבא אותו)
      state.empty = true;
      state.dishes = [];
      state.settings = d.settings;
      if (state.edit) render();
      return;
    }
    state.empty = false;
    var sig = signature(d);
    state.dishes = d.dishes;
    state.settings = d.settings;
    if (sig !== lastSignature || !rendered) {
      lastSignature = sig;
      render();
    }
  }

  /* ---------- מצב עריכה: נטען רק כשצריך ---------- */
  var adminAssets = null;
  function loadAdminAssets() {
    if (adminAssets) return adminAssets;
    adminAssets = new Promise(function (resolve, reject) {
      var link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'admin.css';
      doc.head.appendChild(link);
      var s = doc.createElement('script');
      s.src = 'admin.js';
      s.onload = resolve;
      s.onerror = function () { adminAssets = null; reject(new Error('admin.js')); };
      doc.body.appendChild(s);
    });
    return adminAssets;
  }

  function startEdit() {
    return loadAdminAssets().then(function () {
      return global.KababiaAdmin.start(App);
    }).catch(function (e) {
      if (global.console) console.error(e);
      alertFallback('לא הצלחנו לפתוח את מצב העריכה. בדוק חיבור לאינטרנט ונסה שוב.');
    });
  }
  function alertFallback(msg) { try { global.alert(msg); } catch (e) {} }

  function wantsEdit() {
    return /(^|[?&])edit(=|&|$)/.test(global.location.search) || global.location.hash === '#edit';
  }

  function addLock() {
    var host = doc.querySelector('.footer-inner') || doc.querySelector('main') || doc.body;
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'owner-lock';
    b.setAttribute('aria-label', 'כניסת בעלים');
    b.title = 'כניסת בעלים';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>';
    b.addEventListener('click', startEdit);
    host.appendChild(b);
  }

  /* ---------- מה שהעורך צריך ---------- */
  var App = {
    state: state,
    Store: Store,
    render: render,
    applyFilter: applyFilter,
    getFilter: function () { return currentFilter; },
    esc: esc,
    isShownPublic: isShownPublic,
    dateLabel: dateLabel,
    splitItems: splitItems,
    cleanNote: cleanNote,
    showPopup: maybeShowPopup,
    previewPopup: openPopup,
    closePopup: closePopup,
    reload: function () {
      return Store.load().then(function (d) { applyData(d); });
    }
  };
  global.KababiaApp = App;

  /* ---------- הפעלה ---------- */
  addLock();

  var cached = Store.getCache();
  if (cached) applyData(cached);

  Store.load().then(function (d) {
    applyData(d);
  }, function (err) {
    state.offline = true;
    if (global.console) console.warn('menu: טעינה נכשלה, נשאר התפריט הקיים', err);
  }).then(function () {
    if (wantsEdit()) startEdit(); else maybeShowPopup(false);
  });
})(window);
