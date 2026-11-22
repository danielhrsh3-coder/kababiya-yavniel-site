/* feedback.js - תיבת דירוג פרטית על האתר עצמו (לא על האוכל).
   הגולש רק שולח דירוג והערה; הקריאה מותרת אך ורק לבעל העסק (הרשאות במסד הנתונים).
   לא נשמרים שם, פרטי קשר או כתובת מכשיר. */
(function () {
  var box = document.getElementById('site-feedback');
  if (!box) return;

  var CFG = window.KABABIA_CONFIG || {};
  var KEY = 'kababia_fb_sent';
  var DAY = 24 * 60 * 60 * 1000;

  var openBtn = box.querySelector('.fb-open');
  var form = box.querySelector('.fb-form');
  var starBtns = Array.prototype.slice.call(box.querySelectorAll('.fb-star'));
  var text = box.querySelector('.fb-text');
  var hp = box.querySelector('.fb-hp');
  var msg = box.querySelector('.fb-msg');
  var send = box.querySelector('.fb-send');
  var count = box.querySelector('.fb-count');
  var rating = 0;
  var openedAt = 0;
  var busy = false;

  function sentRecently() {
    try { var t = Number(localStorage.getItem(KEY)); return !!t && Date.now() - t < DAY; } catch (e) { return false; }
  }
  function markSent() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
  }

  function say(t, kind) {
    msg.textContent = t || '';
    msg.className = 'fb-msg' + (kind ? ' is-' + kind : '');
  }

  function paintStars() {
    starBtns.forEach(function (b) {
      var n = Number(b.getAttribute('data-n'));
      b.classList.toggle('is-on', n <= rating);
      b.setAttribute('aria-checked', n === rating ? 'true' : 'false');
    });
  }

  function thanks() {
    form.innerHTML = '<p class="fb-thanks" role="status">תודה רבה! הדירוג נשלח לבעל העסק 🙏</p>';
  }

  function open() {
    if (sentRecently()) { form.hidden = false; openBtn.setAttribute('aria-expanded', 'true'); thanks(); return; }
    var willOpen = form.hidden;
    form.hidden = !willOpen;
    openBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) openedAt = Date.now();
  }

  openBtn.addEventListener('click', open);

  starBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      rating = Number(b.getAttribute('data-n'));
      paintStars();
      say('');
    });
  });

  text.addEventListener('input', function () {
    count.textContent = text.value.length + '/600';
  });

  function post(stars, comment) {
    var base = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
    if (!base || !CFG.supabaseKey) return Promise.reject(new Error('not configured'));
    var h = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    if (/^eyJ/.test(CFG.supabaseKey)) h.Authorization = 'Bearer ' + CFG.supabaseKey;
    return fetch(base + '/rest/v1/site_feedback', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ stars: stars, comment: comment })
    }).then(function (res) {
      if (res.ok) return;
      return res.text().then(function (t) {
        var e = new Error('HTTP ' + res.status + ' ' + String(t || '').slice(0, 200));
        e.status = res.status;
        throw e;
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (!rating) { say('בחרו כמה כוכבים לתת לאתר.', 'error'); return; }

    /* הגנה משליחה אוטומטית: שדה מלכודת ושליחה מהירה מדי נראים כהצלחה אבל לא נשמרים */
    if (hp.value || Date.now() - openedAt < 2000) { markSent(); thanks(); return; }

    busy = true;
    send.disabled = true;
    send.textContent = 'שולח…';
    say('');
    post(rating, text.value.trim().slice(0, 600)).then(function () {
      markSent();
      thanks();
    }, function (err) {
      busy = false;
      send.disabled = false;
      send.textContent = 'שליחה';
      say(err && err.status === 429 || (err && /too many/i.test(err.message || ''))
        ? 'יש כרגע הרבה הודעות. נסו שוב מאוחר יותר.'
        : 'לא הצלחנו לשלוח. בדקו שיש אינטרנט ונסו שוב.', 'error');
    });
  });
})();
