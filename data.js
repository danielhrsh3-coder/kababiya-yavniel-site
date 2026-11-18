/* data.js - נתוני התפריט ושכבת האחסון.
   שני מצבים:
   1. חי (Supabase) - כשמולאו הערכים ב-config.js. הנתונים נשמרים בענן וכל גולש רואה אותם.
   2. הדגמה - כשאין חיבור. התפריט הקיים מוצג, ועריכה נשמרת רק בדפדפן הזה.
   הקוד כתוב בלי ספריות חיצוניות, ישירות מול ה-API של Supabase. */
(function (global) {
  'use strict';

  var CFG = global.KABABIA_CONFIG || {};
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var BASE = LIVE ? String(CFG.supabaseUrl).replace(/\/+$/, '') : '';
  var BUCKET = 'dish-images';
  var DEMO_PASSWORD = '1234';

  /* ---------- localStorage (עוטף, כי לפעמים הוא חסום) ---------- */
  function lsGet(key) {
    try {
      var v = global.localStorage.getItem('kababia.' + key);
      return v ? JSON.parse(v) : null;
    } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { global.localStorage.setItem('kababia.' + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function lsDel(key) {
    try { global.localStorage.removeItem('kababia.' + key); } catch (e) {}
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- תאריכים (שעון ישראל) ---------- */
  function todayIL() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* ---------- התפריט הקיים (נקודת ההתחלה, והגיבוי אם אין חיבור) ---------- */
  function p(price, label) { return { label: label || '', price: price }; }
  var SIZES_3 = function () { return [p(42, 'פיתה'), p(50, 'בגט'), p(55, 'צלחת')]; };

  var SEED_DISHES = [
    { cat: 'hummus', name: 'חומוס פשוט / עם גרגירי חומוס', prices: [p(35)], placeholder: 'hummus' },
    { cat: 'hummus', name: 'חומוס עם תוספת בשר / פטריות / רצועות עוף', prices: [p(45)], placeholder: 'hummus' },
    { cat: 'hummus', name: 'פלאפל בפיתה', prices: [p(18)], placeholder: 'falafel' },
    { cat: 'hummus', name: 'פלאפל + ציפס + שתייה', prices: [p(25)], placeholder: 'falafel' },
    { cat: 'grill', name: 'המבורגר', note: 'קציצה נוספת +10 ₪', prices: [p(45)], image: 'images/burger.jpg' },
    { cat: 'grill', name: 'עראייס', prices: [p(42)], image: 'images/arayes.jpg' },
    { cat: 'grill', name: 'מנת "הקבביה"', prices: [p(42)], image: 'images/kababiya.jpg' },
    { cat: 'grill', name: 'קבב', prices: SIZES_3(), placeholder: 'kabab' },
    { cat: 'grill', name: 'אנטריקוט', prices: [p(42, 'פיתה'), p(50, 'בגט')], placeholder: 'entrecote' },
    { cat: 'grill', name: 'חזה עוף', prices: SIZES_3(), image: 'images/chicken.jpg' },
    { cat: 'grill', name: 'שניצל', prices: SIZES_3(), image: 'images/schnitzel.jpg' },
    { cat: 'grill', name: 'נקנקיות מרגז', prices: [p(42)], image: 'images/merguez.jpg' },
    { cat: 'sides', name: 'ציפס', prices: [p(12)] },
    { cat: 'sides', name: 'טבעות בצל', prices: [p(15)] },
    { cat: 'sides', name: 'מיקס טבעות בצל וציפס', prices: [p(20)] },
    { cat: 'drinks', name: 'שתייה קלה', prices: [p(7)] },
    { cat: 'drinks', name: 'בירה', prices: [p(10)] }
  ];

  var DEFAULT_SETTINGS = {
    popup_enabled: false,
    popup_text: '',
    popup_until: null,
    popup_image: '',
    salads: 'עגבניות · מלפפונים · חמוצים · חסה · סלט חריף · מטבוחה · חומוס · בצל · חריף · כרוב לבן',
    sauces: 'שום · אלף האיים · שזיפים · צ\'ילי מתוק · עמבה · ברביקיו · מיונז · טחינה · קטשופ'
  };

  function normDish(d, i) {
    var prices = Array.isArray(d.prices) ? d.prices : [];
    return {
      id: d.id,
      cat: d.cat || 'grill',
      name: d.name || '',
      note: d.note || '',
      image: d.image || '',
      placeholder: d.placeholder || '',
      prices: prices.map(function (x) { return { label: (x && x.label) || '', price: x ? x.price : '' }; }),
      sort: typeof d.sort === 'number' ? d.sort : (i + 1) * 10,
      visible: d.visible !== false,
      special_date: d.special_date || null,
      special_until: d.special_until || null
    };
  }

  /* חוות דעת על העסק. בכוונה אין ציטוטים לדוגמה: אם אין חוות דעת, הסקשן לא מוצג */
  function normReview(r, i) {
    var stars = Number(r.stars);
    return {
      id: r.id,
      author: r.author || '',
      text: r.text || '',
      stars: stars >= 1 && stars <= 5 ? Math.round(stars) : 5,
      source: r.source || '',
      sort: typeof r.sort === 'number' ? r.sort : (i + 1) * 10,
      visible: r.visible !== false
    };
  }

  function seedDishes() {
    return SEED_DISHES.map(function (d, i) {
      var x = normDish(clone(d), i);
      x.id = 'seed-' + (i + 1);
      return x;
    });
  }

  function mergeSettings(row) {
    var out = clone(DEFAULT_SETTINGS);
    if (!row) return out;
    Object.keys(out).forEach(function (k) {
      if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
    });
    return out;
  }

  function newId() {
    return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var DISH_FIELDS = ['cat', 'name', 'note', 'image', 'placeholder', 'prices', 'sort', 'visible', 'special_date', 'special_until'];
  function dishBody(d) {
    var o = {};
    DISH_FIELDS.forEach(function (k) { o[k] = d[k]; });
    if (!o.special_date) { o.special_date = null; o.special_until = null; }
    if (!o.special_until) o.special_until = null;
    return o;
  }

  var REVIEW_FIELDS = ['author', 'text', 'stars', 'source', 'sort', 'visible'];
  function reviewBody(r) {
    var o = {};
    REVIEW_FIELDS.forEach(function (k) { o[k] = r[k]; });
    return o;
  }

  function isNewId(id) { return !id || /^(seed-|new-)/.test(id); }

  /* ======================================================================
     מצב חי: Supabase דרך REST
     ====================================================================== */
  var session = LIVE ? lsGet('session') : null;
  var refreshing = null;

  function setSession(j) {
    session = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600)
    };
    lsSet('session', session);
  }
  function clearSession() { session = null; lsDel('session'); }

  function authErr(msg) { var e = new Error(msg); e.auth = true; return e; }

  function headers(extra) {
    var h = { apikey: CFG.supabaseKey };
    if (session && session.access_token) h.Authorization = 'Bearer ' + session.access_token;
    else if (/^eyJ/.test(CFG.supabaseKey)) h.Authorization = 'Bearer ' + CFG.supabaseKey;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function refreshToken() {
    if (!session || !session.refresh_token) return Promise.reject(authErr('no session'));
    if (refreshing) return refreshing;
    refreshing = fetch(BASE + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.access_token) { clearSession(); throw authErr('refresh failed'); }
        setSession(j);
      });
    }).then(function (v) { refreshing = null; return v; },
            function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  function ensureFresh() {
    if (session && session.expires_at - Math.floor(Date.now() / 1000) < 60) return refreshToken();
    return Promise.resolve();
  }

  function parse(res) {
    if (res.status === 204) return null;
    return res.text().then(function (t) {
      var data = null;
      try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
      if (!res.ok) {
        var err = new Error((data && (data.message || data.msg || data.error)) || ('HTTP ' + res.status));
        err.status = res.status;
        if (res.status === 401 || res.status === 403) err.auth = !!session;
        throw err;
      }
      return data;
    });
  }

  /* בקשה עם ניסיון חוזר אחד אם פג תוקף הכניסה */
  function call(makeRequest) {
    return ensureFresh().then(makeRequest).then(function (res) {
      if (res.status === 401 && session) {
        return refreshToken().then(makeRequest);
      }
      return res;
    }).then(parse);
  }

  function rest(method, path, body, extra) {
    return call(function () {
      var hdr = headers(body !== undefined ? { 'Content-Type': 'application/json' } : null);
      if (extra) Object.keys(extra).forEach(function (k) { hdr[k] = extra[k]; });
      return fetch(BASE + path, {
        method: method,
        headers: hdr,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    });
  }

  function liveLoad() {
    return Promise.all([
      rest('GET', '/rest/v1/dishes?select=*&order=sort.asc,created_at.asc'),
      rest('GET', '/rest/v1/site_settings?id=eq.1&select=*'),
      rest('GET', '/rest/v1/reviews?select=*&order=sort.asc,created_at.asc').catch(function (e) {
        if (e && e.auth) throw e;
        return [];
      })
    ]).then(function (r) {
      var data = {
        dishes: (r[0] || []).map(normDish),
        settings: mergeSettings(r[1] && r[1][0]),
        reviews: (r[2] || []).map(normReview)
      };
      lsSet('cache', data);
      return data;
    });
  }

  function liveSaveDish(d) {
    var isNew = isNewId(d.id);
    var req = isNew
      ? rest('POST', '/rest/v1/dishes', dishBody(d), { Prefer: 'return=representation' })
      : rest('PATCH', '/rest/v1/dishes?id=eq.' + encodeURIComponent(d.id), dishBody(d), { Prefer: 'return=representation' });
    return req.then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error('השמירה לא אושרה על ידי השרת');
      return normDish(row);
    });
  }

  function liveDeleteDish(id) {
    return rest('DELETE', '/rest/v1/dishes?id=eq.' + encodeURIComponent(id), undefined, { Prefer: 'return=minimal' });
  }

  function liveSaveReview(r) {
    var req = isNewId(r.id)
      ? rest('POST', '/rest/v1/reviews', reviewBody(r), { Prefer: 'return=representation' })
      : rest('PATCH', '/rest/v1/reviews?id=eq.' + encodeURIComponent(r.id), reviewBody(r), { Prefer: 'return=representation' });
    return req.then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error('השמירה לא אושרה על ידי השרת');
      return normReview(row);
    });
  }

  function liveDeleteReview(id) {
    return rest('DELETE', '/rest/v1/reviews?id=eq.' + encodeURIComponent(id), undefined, { Prefer: 'return=minimal' });
  }

  function liveSaveSettings(s) {
    var body = {
      id: 1,
      popup_enabled: !!s.popup_enabled,
      popup_text: s.popup_text || '',
      popup_until: s.popup_until || null,
      popup_image: s.popup_image || '',
      salads: s.salads,
      sauces: s.sauces
    };
    return rest('POST', '/rest/v1/site_settings?on_conflict=id', body,
      { Prefer: 'resolution=merge-duplicates,return=representation' })
      .then(function (rows) { return mergeSettings(Array.isArray(rows) ? rows[0] : rows); });
  }

  function liveUpload(blob) {
    var name = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
    return call(function () {
      return fetch(BASE + '/storage/v1/object/' + BUCKET + '/' + name, {
        method: 'POST',
        headers: headers({ 'Content-Type': blob.type || 'image/jpeg', 'Cache-Control': 'max-age=31536000' }),
        body: blob
      });
    }).then(function () {
      return BASE + '/storage/v1/object/public/' + BUCKET + '/' + name;
    });
  }

  function liveLogin(email, password) {
    return fetch(BASE + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.access_token) {
          var e = new Error('bad credentials');
          e.badCredentials = (r.status === 400 || r.status === 401);
          throw e;
        }
        setSession(j);
      });
    });
  }

  function liveCheckSession() {
    if (!session) return Promise.resolve(false);
    return ensureFresh().then(function () { return true; }, function () { return false; });
  }

  /* ======================================================================
     מצב הדגמה: הכול בדפדפן
     ====================================================================== */
  function demoState() {
    var s = lsGet('demo');
    if (!s) s = { dishes: seedDishes(), settings: clone(DEFAULT_SETTINGS), reviews: [] };
    s.dishes = s.dishes.map(normDish);
    s.settings = mergeSettings(s.settings);
    s.reviews = (s.reviews || []).map(normReview);
    return s;
  }
  function demoPersist(s) {
    if (!lsSet('demo', s)) throw new Error('אין מקום לשמירה בדפדפן (נסה תמונה קטנה יותר)');
  }

  function demoLoad() { return Promise.resolve(demoState()); }

  function demoSaveDish(d) {
    return new Promise(function (resolve) {
      var s = demoState();
      var saved = normDish(clone(d));
      if (!saved.id || /^new-/.test(saved.id)) saved.id = newId();
      var idx = -1;
      s.dishes.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
      if (idx >= 0) s.dishes[idx] = saved; else s.dishes.push(saved);
      demoPersist(s);
      resolve(saved);
    });
  }

  function demoDeleteDish(id) {
    return new Promise(function (resolve) {
      var s = demoState();
      s.dishes = s.dishes.filter(function (x) { return x.id !== id; });
      demoPersist(s);
      resolve();
    });
  }

  function demoSaveReview(r) {
    return new Promise(function (resolve) {
      var s = demoState();
      var saved = normReview(clone(r));
      if (!saved.id || /^new-/.test(saved.id)) saved.id = newId();
      var idx = -1;
      s.reviews.forEach(function (x, i) { if (x.id === saved.id) idx = i; });
      if (idx >= 0) s.reviews[idx] = saved; else s.reviews.push(saved);
      demoPersist(s);
      resolve(saved);
    });
  }

  function demoDeleteReview(id) {
    return new Promise(function (resolve) {
      var s = demoState();
      s.reviews = s.reviews.filter(function (x) { return x.id !== id; });
      demoPersist(s);
      resolve();
    });
  }

  function demoSaveSettings(settings) {
    return new Promise(function (resolve) {
      var s = demoState();
      s.settings = mergeSettings(settings);
      demoPersist(s);
      resolve(s.settings);
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('לא הצלחנו לקרוא את התמונה')); };
      fr.readAsDataURL(blob);
    });
  }

  function demoLogin(email, password) {
    if (password === DEMO_PASSWORD) { lsSet('demo_auth', true); return Promise.resolve(); }
    var e = new Error('bad credentials'); e.badCredentials = true;
    return Promise.reject(e);
  }

  /* ======================================================================
     הממשק האחיד שהאתר משתמש בו
     ====================================================================== */
  var Store = {
    live: LIVE,
    demoPassword: DEMO_PASSWORD,
    todayIL: todayIL,
    addDays: addDays,
    seedDishes: seedDishes,
    defaultSettings: function () { return clone(DEFAULT_SETTINGS); },

    getCache: function () {
      if (!LIVE) return null;
      var c = lsGet('cache');
      if (!c || !Array.isArray(c.dishes)) return null;
      return {
        dishes: c.dishes.map(normDish),
        settings: mergeSettings(c.settings),
        reviews: (c.reviews || []).map(normReview)
      };
    },
    load: function () { return LIVE ? liveLoad() : demoLoad(); },

    saveDish: function (d) { return LIVE ? liveSaveDish(d) : demoSaveDish(d); },
    deleteDish: function (id) { return LIVE ? liveDeleteDish(id) : demoDeleteDish(id); },
    saveReview: function (r) { return LIVE ? liveSaveReview(r) : demoSaveReview(r); },
    deleteReview: function (id) { return LIVE ? liveDeleteReview(id) : demoDeleteReview(id); },
    saveSettings: function (s) { return LIVE ? liveSaveSettings(s) : demoSaveSettings(s); },
    uploadImage: function (blob) { return LIVE ? liveUpload(blob) : blobToDataURL(blob); },

    importSeed: function () {
      var list = seedDishes().map(function (d, i) { d.sort = (i + 1) * 10; d.id = null; return d; });
      return list.reduce(function (chain, d) {
        return chain.then(function () { return Store.saveDish(d); });
      }, Promise.resolve());
    },

    isLoggedIn: function () {
      return LIVE ? !!(session && session.refresh_token) : !!lsGet('demo_auth');
    },
    checkSession: function () {
      return LIVE ? liveCheckSession() : Promise.resolve(!!lsGet('demo_auth'));
    },
    login: function (email, password) {
      return LIVE ? liveLogin(email, password) : demoLogin(email, password);
    },
    logout: function () {
      if (LIVE) clearSession(); else lsDel('demo_auth');
    },
    resetDemo: function () { lsDel('demo'); }
  };

  global.KababiaStore = Store;
})(window);
