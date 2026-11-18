/* sw.js - שירות מינימלי כדי שהדפדפן יאפשר "התקנה" כאפליקציה.
   בכוונה לא שומר קבצים בזיכרון, כדי שעדכוני האתר יופיעו תמיד מיד. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* עובר ישר לרשת */ });
