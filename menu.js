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
    reviews: [],
    top: [],          // 3 המנות המובילות לפי הלקוחות
    voteStats: {},    // לבעלים בלבד: סיכום דירוגים לכל מנה (ממלא admin.js)
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

  /* ספיישל = מנה עם תאריך התחלה (special_date) ותאריך סיום אופציונלי (special_until) */
  function endOf(d) {
    return d.special_until && d.special_until > d.special_date ? d.special_until : d.special_date;
  }

  function isShownPublic(d, today) {
    if (d.visible === false) return false;
    if (!d.special_date) return true;
    return today >= d.special_date && today <= endOf(d);
  }

  function dmy(date) {
    var p = date.split('-');
    return p[2] + '.' + p[1];
  }

  function specialLabel(d, today) {
    var end = endOf(d);
    var single = end === d.special_date;
    if (d.special_date > today) {
      if (single) return d.special_date === Store.addDays(today, 1) ? 'מחר בלבד' : 'ב-' + dmy(d.special_date) + ' בלבד';
      return dmy(d.special_date) + ' עד ' + dmy(end);
    }
    if (single) return 'היום בלבד';
    if (end === today) return 'היום האחרון';
    return 'עד ' + dmy(end);
  }

  /* ---------- אייקוני תמונה חסרה (כמו שהיה באתר) ---------- */
  var ICONS = {
    hummus: '<path d="M4 11a8 8 0 0 1 16 0v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-1zm-1 4h18v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2z"/>',
    falafel: '<circle cx="7" cy="8" r="2.4"/><circle cx="13" cy="6.5" r="2.4"/><circle cx="17.5" cy="10.5" r="2.4"/><circle cx="9" cy="13.5" r="2.4"/><circle cx="14.5" cy="15" r="2.4"/>',
    kabab: '<path d="M4 3c-.55 0-1 .45-1 1s.45 1 1 1h1v11a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V5h1c.55 0 1-.45 1-1s-.45-1-1-1H4zm4 4h2v9H8V7zm4 0h2v9h-2V7zm4 0h2v9h-2V7z"/>',
    generic: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/>'
  };
  ICONS.entrecote = ICONS.kabab;
  ICONS.special = '<path d="M19.48 12.35c-1.57-4.08-7.16-4.3-5.81-10.23.1-.44-.37-.78-.75-.55C9.29 3.71 6.68 8 8.87 13.62c.18.46-.36.89-.75.59-1.81-1.37-2-3.34-1.84-4.75.06-.52-.62-.77-.91-.34C4.69 10.16 4 11.84 4 14.37c.38 5.6 5.11 7.32 6.81 7.54 2.43.31 5.06-.14 6.95-1.87 2.08-1.93 2.84-5.01 1.72-7.69z"/>';

  function placeholderKey(d) {
    if (d.placeholder && ICONS[d.placeholder]) return d.placeholder;
    if (d.special_date) return 'special';
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
      if (endOf(d) < today) return ed ? '<span class="dish-tag is-expired">פג תוקף</span>' : '';
      var future = d.special_date > today;
      return '<span class="dish-tag ' + (future ? 'is-future' : 'is-temp') + '">' + esc(specialLabel(d, today)) + '</span>';
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

  /* ---------- דירוג אימוג'י ---------- */
  var FACES = ['😞', '😕', '😐', '🙂', '😁'];
  var FACE_NAMES = ['לא טעים', 'ככה ככה', 'בסדר', 'טעים', 'מעולה'];
  var VOTED_KEY = 'kababia_votes';
  var VOTE_DAYS = 30;

  function votedMap() {
    try { var v = JSON.parse(global.localStorage.getItem(VOTED_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch (e) { return {}; }
  }
  function votedScore(id) {
    var v = votedMap()[id];
    if (!v || !v.t || Date.now() - v.t > VOTE_DAYS * 864e5) return 0;
    return v.s || 0;
  }
  function markVoted(id, score) {
    var m = votedMap();
    m[id] = { s: score, t: Date.now() };
    try { global.localStorage.setItem(VOTED_KEY, JSON.stringify(m)); } catch (e) {}
  }
  /* בחיבור חי מדרגים רק מנות שכבר שמורות במסד (לא את התפריט הסטטי לגיבוי) */
  function canRate(d) {
    if (!d || !d.id) return false;
    return Store.live ? /^[0-9a-f-]{36}$/i.test(d.id) : true;
  }

  function rateHTML(d) {
    if (!canRate(d)) return '';
    var mine = votedScore(d.id);
    if (mine) {
      return '<div class="dish-rate is-done" data-rate="' + esc(d.id) + '">' +
        '<span class="dish-rate-thanks">' + FACES[mine - 1] + ' תודה על הדירוג!</span></div>';
    }
    return '<div class="dish-rate" data-rate="' + esc(d.id) + '">' +
      '<span class="dish-rate-q">איך היה?</span>' +
      '<span class="dish-rate-faces" role="group" aria-label="דירוג ' + esc(d.name) + '">' +
      FACES.map(function (f, i) {
        return '<button type="button" class="dish-rate-btn" data-score="' + (i + 1) + '" aria-label="' + FACE_NAMES[i] + '" title="' + FACE_NAMES[i] + '">' + f + '</button>';
      }).join('') +
      '</span></div>';
  }

  function topRank(id) {
    for (var i = 0; i < state.top.length; i++) if (state.top[i].dish_id === id) return state.top[i].rank;
    return 0;
  }
  function topHTML(d) {
    var r = topRank(d.id);
    return r ? '<span class="dish-top" title="מקום ' + r + ' בדירוג הלקוחות" aria-label="מקום ' + r + ' בדירוג הלקוחות">⭐' + r + '</span>' : '';
  }
  function soldHTML(d) { return d.sold_out ? '<span class="dish-tag is-soldout">אזל</span>' : ''; }

  /* כלים לבעלים ליד כל מנה: מתג "אזל" וסיכום הדירוגים */
  function ownerToolsHTML(d, withRates) {
    var st = state.voteStats[d.id];
    var chip = '';
    if (withRates) {
      if (st && st.n) {
        chip = '<button type="button" class="ed-rate-chip" data-rates="' + esc(d.id) + '">' +
          FACES[Math.max(0, Math.min(4, Math.round(st.avg) - 1))] + ' ' + st.avg.toFixed(1) + ' · ' + st.n + ' דירוגים' +
          (st.comments ? ' · 💬 ' + st.comments : '') + '</button>';
      } else {
        chip = '<button type="button" class="ed-rate-chip is-empty" data-rates="' + esc(d.id) + '">עוד אין דירוגים</button>';
      }
    }
    return '<span class="ed-dish-tools">' +
      '<label class="ed-switch ed-soldout"><input type="checkbox" data-soldout="' + esc(d.id) + '"' + (d.sold_out ? ' checked' : '') + '>' +
      '<span class="ed-switch-ui"></span><span>אזל</span></label>' + chip + '</span>';
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
    var special = !!d.special_date;
    var tags = topHTML(d) + soldHTML(d) + tagHTML(d, today, ed);
    return '<div class="menu-dish' + (special ? ' is-special' : '') + (d.sold_out ? ' is-soldout' : '') + (ed && !shown ? ' is-off' : '') + '" data-cat="' + (special ? 'specials' : esc(d.cat)) + '" data-id="' + esc(d.id) + '">' +
      img +
      '<div class="menu-dish-info">' +
        (tags ? '<span class="dish-tags">' + tags + '</span>' : '') +
        '<span class="menu-dish-name">' + esc(d.name) + (note ? ' <em>(' + esc(note) + ')</em>' : '') + '</span>' +
        pricesHTML(d) +
        (ed ? ownerToolsHTML(d, true) : rateHTML(d)) +
      '</div>' +
      (ed ? pencil('data-edit="' + esc(d.id) + '"', 'עריכת המנה ' + d.name) : '') +
    '</div>';
  }

  function liHTML(d, today, ed) {
    var shown = isShownPublic(d, today);
    var ps = (d.prices || []).filter(function (x) { return String(x.price).trim() !== ''; });
    var priceText = ps.map(function (x) { return (x.label ? x.label + ' ' : '') + fmtPrice(x.price); }).join(' · ');
    var note = cleanNote(d.note);
    var tag = soldHTML(d) + tagHTML(d, today, ed);
    var left = '<span class="price">' + esc(priceText) + '</span>';
    return '<li class="' + (ed && !shown ? 'is-off' : '') + (d.sold_out ? ' is-soldout' : '') + '" data-id="' + esc(d.id) + '">' +
      '<span>' + tag + esc(d.name) + (note ? ' <em>(' + esc(note) + ')</em>' : '') + '</span>' +
      (ed ? '<span class="ed-li-end">' + left + ownerToolsHTML(d, false) + pencil('data-edit="' + esc(d.id) + '"', 'עריכת ' + d.name) + '</span>' : left) +
    '</li>';
  }

  function render() {
    var today = Store.todayIL();
    var ed = state.edit;
    var list = state.dishes.filter(function (d) { return ed || isShownPublic(d, today); });
    var specials = list.filter(function (d) { return d.special_date; });
    var regular = list.filter(function (d) { return !d.special_date; });
    var main = regular.filter(function (d) { return d.cat === 'grill' || d.cat === 'hummus'; });
    var sides = regular.filter(function (d) { return d.cat === 'sides'; });
    var drinks = regular.filter(function (d) { return d.cat === 'drinks'; });
    var html = '';

    if (specials.length || ed) {
      html += '<div class="menu-group menu-group-specials" data-cat="specials">' +
        '<h3><span aria-hidden="true">🔥</span> ספיישלים לזמן מוגבל</h3>' +
        '<div class="menu-dish-list">' +
        specials.map(function (d) { return dishHTML(d, today, ed); }).join('') +
        (ed ? '<button type="button" class="ed-add-tile" data-add="special"><span>＋</span> הוסף ספיישל</button>' : '') +
        '</div></div>';
    }
    syncSpecialsTab(specials.length > 0);

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
    renderReviews();
  }

  /* טאב "ספיישלים" מופיע רק כשיש ספיישלים */
  function syncSpecialsTab(has) {
    var tabs = doc.querySelector('.menu-tabs');
    if (!tabs) return;
    var t = tabs.querySelector('[data-filter="specials"]');
    if (has && !t) {
      t = doc.createElement('button');
      t.type = 'button';
      t.className = 'menu-tab menu-tab-special';
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('data-filter', 'specials');
      t.textContent = '🔥 ספיישלים';
      var all = tabs.querySelector('[data-filter="all"]');
      tabs.insertBefore(t, all ? all.nextSibling : tabs.firstChild);
    } else if (!has && t) {
      tabs.removeChild(t);
      if (currentFilter === 'specials') currentFilter = 'all';
    }
  }

  /* ---------- חוות דעת ---------- */
  function starsText(n) {
    var out = '';
    for (var i = 0; i < 5; i++) out += i < n ? '★' : '☆';
    return out;
  }

  function reviewHTML(r, ed) {
    var who = '';
    if (r.author) who = '— ' + esc(r.author) + (r.source ? ' · ' + esc(r.source) : '');
    else if (r.source) who = '— ' + esc(r.source);
    var off = ed && r.visible === false;
    return '<div class="review-card' + (off ? ' is-off' : '') + ((r.text || '').length > 240 ? ' is-long' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="review-stars" role="img" aria-label="' + r.stars + ' כוכבים מתוך 5">' + starsText(r.stars) + '</div>' +
      '<p class="review-text">' + esc(r.text) + '</p>' +
      (who ? '<span class="review-author">' + who + '</span>' : '') +
      (/^https?:\/\//i.test(r.url || '') ? '<a class="review-link" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">לצפייה בביקורת המקורית ←</a>' : '') +
      (off ? '<span class="dish-tag is-off">מוסתרת</span>' : '') +
      (ed ? pencil('data-edit-review="' + esc(r.id) + '"', 'עריכת חוות דעת' + (r.author ? ' של ' + r.author : '')) : '') +
    '</div>';
  }

  function renderReviews() {
    var ed = state.edit;
    var all = (state.reviews || []).filter(function (r) { return ed || r.visible !== false; });

    /* ביקורות גוגל הקיימות */
    var sec = doc.getElementById('reviews');
    var grid = doc.getElementById('reviews-grid');
    if (sec && grid) {
      var list = all.filter(function (r) { return !r.from_screenshot; });
      sec.hidden = !list.length;
      grid.innerHTML = list.map(function (r) { return reviewHTML(r, ed); }).join('');
    }

    /* ביקורות שנוספו מצילום מסך: סקשן משלהן */
    var sec2 = doc.getElementById('reviews-google');
    var grid2 = doc.getElementById('reviews-shots-grid');
    if (sec2 && grid2) {
      var shots = all.filter(function (r) { return r.from_screenshot; });
      sec2.hidden = !(shots.length || ed);
      grid2.innerHTML = shots.map(function (r) { return reviewHTML(r, ed); }).join('') +
        (ed ? '<button type="button" class="ed-add-tile" data-add-shot><span>📷</span> הוסף ביקורת מצילום מסך</button>' : '');
    }
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

  /* ---------- לחיצה על אימוג'י ---------- */
  function sendVote(box, id, score, comment) {
    markVoted(id, score);
    box.className = 'dish-rate is-done';
    box.innerHTML = '<span class="dish-rate-thanks">' + FACES[score - 1] + ' תודה על הדירוג!</span>';
    Store.vote(id, score, comment).catch(function (e) {
      if (global.console) console.warn('vote failed', e);
    });
  }

  function askComment(box, id, score) {
    box.className = 'dish-rate is-asking';
    box.innerHTML =
      '<span class="dish-rate-chosen">' + FACES[score - 1] + '</span>' +
      '<label class="dish-rate-label" for="rate-c-' + esc(id) + '">מה לא אהבת? אפשר לכתוב לנו, זה אופציונלי</label>' +
      '<textarea class="dish-rate-text" id="rate-c-' + esc(id) + '" rows="2" maxlength="400"></textarea>' +
      '<span class="dish-rate-actions">' +
        '<button type="button" class="dish-rate-send">שליחה</button>' +
        '<button type="button" class="dish-rate-skip">בלי הערה</button>' +
      '</span>';
    var ta = box.querySelector('textarea');
    try { ta.focus({ preventScroll: true }); } catch (e) {}
    box.querySelector('.dish-rate-send').addEventListener('click', function () { sendVote(box, id, score, ta.value.trim().slice(0, 400)); });
    box.querySelector('.dish-rate-skip').addEventListener('click', function () { sendVote(box, id, score, ''); });
  }

  doc.addEventListener('click', function (e) {
    if (state.edit) return;
    var b = e.target.closest ? e.target.closest('.dish-rate-btn') : null;
    if (!b) return;
    var box = b.closest('.dish-rate');
    var id = box && box.getAttribute('data-rate');
    var score = Number(b.getAttribute('data-score'));
    if (!id || !(score >= 1 && score <= 5) || votedScore(id)) return;
    if (score <= 3) askComment(box, id, score); else sendVote(box, id, score, '');
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

  function openPopup(text, image) {
    closePopup();
    var el = doc.createElement('div');
    el.className = 'site-popup';
    el.innerHTML =
      '<div class="site-popup-card' + (image ? ' has-image' : '') + '" role="dialog" aria-modal="true" aria-label="הודעה מהקבביה">' +
        (image ? '<img class="site-popup-img" alt="">' : '<img class="site-popup-logo" src="images/logo.jpg" alt="">') +
        (text ? '<p class="site-popup-text"></p>' : '') +
        '<button type="button" class="btn btn-whatsapp site-popup-close">הבנתי</button>' +
      '</div>';
    if (image) el.querySelector('.site-popup-img').setAttribute('src', image);
    if (text) el.querySelector('.site-popup-text').textContent = text;
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
    var image = String(s.popup_image || '').trim();
    if (!text && !image) return;
    if (!force) {
      if (!s.popup_enabled) return;
      if (s.popup_until && s.popup_until < Store.todayIL()) return;
      var key = 'kababia.popup.' + hashText(text + '|' + image.slice(-60));
      try {
        if (global.sessionStorage.getItem(key)) return;
        global.sessionStorage.setItem(key, '1');
      } catch (e) {}
    }
    openPopup(text, image);
  }

  /* ---------- טעינת הנתונים ---------- */
  function signature(d) { return JSON.stringify([d.dishes, d.settings, d.reviews, d.top]); }

  function notifySettings() {
    try { doc.dispatchEvent(new CustomEvent('kababia:settings', { detail: state.settings })); } catch (e) {}
  }

  function applyData(d) {
    state.reviews = d.reviews || [];
    state.top = d.top || [];
    if (!d.dishes.length) {
      // מסד ריק: משאירים את התפריט הסטטי שב-HTML (ובעריכה אפשר לייבא אותו)
      state.empty = true;
      state.dishes = [];
      state.settings = d.settings;
      notifySettings();
      if (state.edit) render(); else if (state.reviews.length) renderReviews();
      return;
    }
    state.empty = false;
    var sig = signature(d);
    state.dishes = d.dishes;
    state.settings = d.settings;
    notifySettings();
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
      link.href = 'admin.css?v=20261126e';
      doc.head.appendChild(link);
      var s = doc.createElement('script');
      s.src = 'admin.js?v=20261126e';
      s.onload = resolve;
      s.onerror = function () { adminAssets = null; reject(new Error('admin.js')); };
      doc.body.appendChild(s);
    });
    return adminAssets;
  }

  /* מסך שחור מלא בזמן הכניסה לעריכה: לפני ההתחברות לא רואים כלום מהאתר, רק את חלון הכניסה */
  function gate(on) {
    var h = doc.documentElement;
    if (on) { if (!/\bed-gate\b/.test(h.className)) h.className += ' ed-gate'; }
    else h.className = h.className.replace(/\s*\bed-gate\b/g, '');
  }

  var CFG = global.KABABIA_CONFIG || {};
  var GATE_ALL = !!CFG.gateAll;

  function startEdit() {
    gate(true);
    return loadAdminAssets().then(function () {
      return global.KababiaAdmin.start(App);
    }).catch(function (e) {
      if (global.console) console.error(e);
      alertFallback('לא הצלחנו לפתוח את מצב העריכה. בדוק חיבור לאינטרנט ונסה שוב.');
      return false;
    }).then(function (ok) {
      if (ok === false && GATE_ALL) return;   // אתר פרטי: נשארים במסך שחור גם אם משהו נכשל
      gate(false);
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
    endOf: endOf,
    specialLabel: specialLabel,
    renderReviews: renderReviews,
    FACES: FACES,
    FACE_NAMES: FACE_NAMES,
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
  /* אין כפתור כניסת בעלים באתר הציבורי. הבעלים נכנס דרך edit.html (שאין אליו קישור מהאתר). */

  var cached = Store.getCache();
  if (cached) applyData(cached);

  Store.load().then(function (d) {
    applyData(d);
  }, function (err) {
    state.offline = true;
    if (global.console) console.warn('menu: טעינה נכשלה, נשאר התפריט הקיים', err);
  }).then(function () {
    if (GATE_ALL && CFG.rememberLogin === false) Store.logout();
    if (GATE_ALL || wantsEdit()) startEdit(); else maybeShowPopup(false);
  });
})(window);
