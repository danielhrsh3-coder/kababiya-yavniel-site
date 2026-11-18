/* hours.js - שעות פתיחה: שעות קבועות לכל יום + שינויים זמניים לטווח תאריכים.
   הכול מחושב לפי שעון ישראל (Asia/Jerusalem), לא לפי שעון המכשיר של הגולש.
   הנתונים מגיעים מהמסד (site_settings.hours / hours_overrides). בלי נתונים נשארות ברירות המחדל שכאן. */
(function (global) {
  'use strict';

  var doc = global.document;
  var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  var DEFAULT_HOURS = {
    0: ['12:00', '22:00'], 1: ['12:00', '22:00'], 2: ['12:00', '22:00'],
    3: ['12:00', '22:00'], 4: ['12:00', '22:00'], 5: null, 6: null
  };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- זמן ותאריכים ---------- */
  function toMin(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return NaN;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
    return h * 60 + mi;
  }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function fmt(mins) { return two(Math.floor(mins / 60) % 24) + ':' + two(mins % 60); }

  function addDays(ds, n) {
    var d = new Date(ds + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dowOf(ds) { return new Date(ds + 'T12:00:00Z').getUTCDay(); }   // 0 = ראשון
  function dm(ds) { return ds.slice(8, 10) + '.' + ds.slice(5, 7); }

  function israelNow() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    function get(t) { var p = parts.filter(function (x) { return x.type === t; })[0]; return p ? p.value : null; }
    var hour = parseInt(get('hour'), 10);
    return {
      date: get('year') + '-' + get('month') + '-' + get('day'),
      dow: DAY_INDEX[get('weekday')],
      minutes: (hour === 24 ? 0 : hour) * 60 + parseInt(get('minute'), 10)
    };
  }

  /* ---------- נרמול ---------- */
  // טווח שעות תקין: [פתיחה, סגירה]. סגירה "00:00" = חצות. סגירה חייבת להיות אחרי הפתיחה.
  function parseRange(arr) {
    if (!Array.isArray(arr) || arr.length !== 2) return undefined;
    var o = toMin(arr[0]), c = toMin(arr[1]);
    if (isNaN(o) || isNaN(c)) return undefined;
    if (c === 0) c = 1440;
    if (c <= o || o >= 1440) return undefined;
    return { open: fmt(o), close: fmt(c), o: o, c: c };
  }

  // מחזיר מערך של 7 ימים (0 = ראשון): null = סגור, או {open, close, o, c}
  function normHours(raw) {
    var out = [];
    for (var d = 0; d < 7; d++) {
      var v = raw && typeof raw === 'object' ? raw[d] : undefined;
      var r;
      if (v === null) r = null;
      else {
        r = parseRange(v);
        if (r === undefined) r = parseRange(DEFAULT_HOURS[d]) || null;
      }
      out.push(r);
    }
    return out;
  }
  function serializeHours(weekly) {
    var o = {};
    for (var d = 0; d < 7; d++) o[d] = weekly[d] ? [weekly[d].open, weekly[d].close] : null;
    return o;
  }

  function normOverrides(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (x) {
      if (!x || !DATE_RE.test(String(x.from || ''))) return;
      var to = DATE_RE.test(String(x.to || '')) ? x.to : x.from;
      if (to < x.from) return;
      var o = { from: x.from, to: to, closed: !!x.closed, note: String(x.note || '').trim().slice(0, 80) };
      if (!o.closed) {
        var r = parseRange([x.open, x.close]);
        if (!r) return;
        o.open = r.open; o.close = r.close; o.o = r.o; o.c = r.c;
      }
      out.push(o);
    });
    return out;
  }
  function serializeOverrides(list) {
    return list.map(function (o) {
      var s = { from: o.from, to: o.to, closed: !!o.closed, note: o.note || '' };
      if (!o.closed) { s.open = o.open; s.close = o.close; }
      return s;
    });
  }

  function build(settings) {
    return {
      weekly: normHours(settings && settings.hours),
      overrides: normOverrides(settings && settings.hours_overrides)
    };
  }

  /* ---------- חישוב ---------- */
  // מה קורה בתאריך מסוים: שינוי זמני (אם יש) גובר על השעות הקבועות. אם כמה חופפים, המאוחר יותר גובר.
  function dayInfo(S, ds) {
    var hit = null;
    S.overrides.forEach(function (o) {
      if (o.from <= ds && ds <= o.to && (!hit || o.from >= hit.from)) hit = o;
    });
    if (hit) {
      return hit.closed
        ? { closed: true, temp: true, note: hit.note }
        : { closed: false, temp: true, note: hit.note, open: hit.open, close: hit.close, o: hit.o, c: hit.c };
    }
    var w = S.weekly[dowOf(ds)];
    return w ? { closed: false, temp: false, note: '', open: w.open, close: w.close, o: w.o, c: w.c }
             : { closed: true, temp: false, note: '' };
  }

  function status(S, now) {
    var today = dayInfo(S, now.date);
    if (!today.closed && now.minutes >= today.o && now.minutes < today.c) {
      return { open: true, closesAt: today.c, note: today.note };
    }
    for (var i = 0; i <= 60; i++) {
      var ds = i === 0 ? now.date : addDays(now.date, i);
      var info = i === 0 ? today : dayInfo(S, ds);
      if (info.closed) continue;
      if (i === 0 && now.minutes >= info.o) continue;   // היום כבר נסגרנו
      return { open: false, note: today.note, next: { offset: i, date: ds, dow: dowOf(ds), at: info.o } };
    }
    return { open: false, note: today.note, next: null };
  }

  /* ---------- תצוגה באתר ---------- */
  var current = build(null);

  function renderBadge(now) {
    var badge = doc.getElementById('open-badge');
    if (!badge) return;
    var labelEl = badge.querySelector('.open-label');
    var detailEl = badge.querySelector('.open-detail');
    if (!labelEl || !detailEl || now.dow === undefined || isNaN(now.minutes)) return;
    var st = status(current, now);
    if (st.open) {
      badge.classList.add('is-open');
      labelEl.textContent = 'פתוח עכשיו';
      detailEl.textContent = '· עד ' + fmt(st.closesAt);
    } else {
      badge.classList.remove('is-open');
      labelEl.textContent = 'סגור';
      var n = st.next;
      detailEl.textContent = !n ? '' :
        n.offset === 0 ? '· נפתח ב-' + fmt(n.at) :
        n.offset <= 6 ? '· נפתח ב' + DAY_NAMES[n.dow] + ' ' + fmt(n.at) :
        '· נפתח ב-' + dm(n.date) + ' ' + fmt(n.at);
    }
    if (st.note) badge.setAttribute('title', st.note); else badge.removeAttribute('title');
    badge.hidden = false;
  }

  // טבלת השעות הקבועות: ימים עוקבים עם אותן שעות מאוחדים לשורה אחת
  function renderTable() {
    var tbody = doc.querySelector('.hours-table tbody');
    if (!tbody) return;
    var runs = [];
    current.weekly.forEach(function (w, d) {
      var key = w ? w.open + '-' + w.close : 'x';
      var last = runs[runs.length - 1];
      if (last && last.key === key) last.to = d; else runs.push({ key: key, from: d, to: d, w: w });
    });
    tbody.innerHTML = runs.map(function (r) {
      var label = r.from === r.to ? DAY_NAMES[r.from] : DAY_NAMES[r.from] + ' &ndash; ' + DAY_NAMES[r.to];
      return '<tr><th scope="row">' + label + '</th>' +
        (r.w ? '<td>' + r.w.open + '&ndash;' + r.w.close + '</td>' : '<td class="is-closed">סגור</td>') + '</tr>';
    }).join('');
  }

  // שינויים זמניים שפעילים עכשיו או מתחילים בשבועיים הקרובים
  function renderNotes(now) {
    var box = doc.getElementById('hours-notes');
    if (!box) return;
    var horizon = addDays(now.date, 14);
    var list = current.overrides
      .filter(function (o) { return o.to >= now.date && o.from <= horizon; })
      .sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; })
      .slice(0, 5);
    box.textContent = '';
    if (!list.length) { box.hidden = true; return; }
    var title = doc.createElement('p');
    title.className = 'hours-notes-title';
    title.textContent = 'שינויים בשעות';
    var ul = doc.createElement('ul');
    list.forEach(function (o) {
      var li = doc.createElement('li');
      var when = o.from === o.to ? DAY_NAMES[dowOf(o.from)] + ' ' + dm(o.from) : dm(o.from) + ' עד ' + dm(o.to);
      var what = o.closed ? 'סגור' : o.open + '–' + o.close;
      li.textContent = when + ': ' + what + (o.note ? ' · ' + o.note : '');
      ul.appendChild(li);
    });
    box.appendChild(title);
    box.appendChild(ul);
    box.hidden = false;
  }

  function render() {
    var now;
    try { now = israelNow(); } catch (e) { return; }
    renderBadge(now);
    renderNotes(now);
  }

  function apply(settings) {
    current = build(settings);
    renderTable();
    render();
  }

  /* ---------- הפעלה ---------- */
  var app = global.KababiaApp;
  apply(app && app.state ? app.state.settings : null);
  doc.addEventListener('kababia:settings', function (e) { apply(e.detail); });
  setInterval(render, 60000);

  global.KababiaHours = {
    DAY_NAMES: DAY_NAMES,
    toMin: toMin, fmt: fmt, dm: dm, addDays: addDays, dowOf: dowOf,
    israelNow: israelNow,
    normHours: normHours, serializeHours: serializeHours,
    normOverrides: normOverrides, serializeOverrides: serializeOverrides,
    parseRange: parseRange, build: build, dayInfo: dayInfo, status: status,
    apply: apply
  };
})(window);
