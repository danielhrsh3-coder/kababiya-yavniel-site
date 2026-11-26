/* track.js - ספירה אנונימית לדשבורד של בעל העסק: ביקורים ולחיצות על Waze / וואטסאפ / חיוג.
   לא נשמר שום פרט מזהה: רק סוג האירוע והשעה.
   גולש שחוזר מאותו מכשיר תוך שעתיים נספר כביקור אחד.
   בעל העסק עצמו (מחובר או במצב עריכה) לא נספר. */
(function (global) {
  'use strict';

  var CFG = global.KABABIA_CONFIG || {};
  var BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  if (!BASE || !CFG.supabaseKey) return;

  var VISIT_KEY = 'kababia_last_visit';
  var TWO_HOURS = 2 * 60 * 60 * 1000;

  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }

  function isOwner() {
    if (/(^|[?&])edit(=|&|$)/.test(global.location.search) || global.location.hash === '#edit') return true;
    if (document.body && document.body.classList.contains('ed-on')) return true;
    return !!lsGet('kababia.session');
  }

  function send(kind) {
    if (isOwner()) return;
    var h = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    if (/^eyJ/.test(CFG.supabaseKey)) h.Authorization = 'Bearer ' + CFG.supabaseKey;
    try {
      fetch(BASE + '/rest/v1/site_events', {
        method: 'POST', headers: h, keepalive: true, body: JSON.stringify({ kind: kind })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ביקור */
  var last = Number(lsGet(VISIT_KEY));
  var now = Date.now();
  if (!isOwner() && (!last || now - last > TWO_HOURS)) {
    send('visit');
    lsSet(VISIT_KEY, String(now));
  }

  /* לחיצות על הכפתורים */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/waze\.com/i.test(href)) send('waze');
    else if (/wa\.me|whatsapp/i.test(href)) send('whatsapp');
    else if (/^tel:/i.test(href)) send('call');
  }, true);
})(window);
