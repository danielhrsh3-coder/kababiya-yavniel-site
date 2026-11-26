// read-review: קורא צילום מסך של ביקורת גוגל בעזרת Gemini ומחזיר שם, כוכבים וטקסט.
// המפתח של Gemini נשמר כסוד ב-Supabase (GEMINI_API_KEY) ואף פעם לא מגיע לדפדפן.
// רק בעל האתר המחובר יכול להפעיל את הפונקציה (נבדק מול is_owner במסד).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

const PROMPT =
  "This image is a screenshot of a single Google Maps review, usually in Hebrew. " +
  "Extract: author = the reviewer's display name exactly as written; " +
  "stars = the number of filled stars (1-5); " +
  "text = the full review text exactly as written, keeping line breaks and emojis, " +
  "without the name, date, stars, 'Local Guide' labels, owner replies or buttons. " +
  "If something is not visible, return an empty string (or 0 for stars).";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    author: { type: "STRING" },
    stars: { type: "INTEGER" },
    text: { type: "STRING" },
  },
  required: ["author", "stars", "text"],
};

async function isOwner(auth: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon || !auth) return false;
  const r = await fetch(url + "/rest/v1/rpc/is_owner", {
    method: "POST",
    headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

// כל ניסיון מוגבל בזמן, כדי שלא נחכה דקה שלמה כש-Gemini עמוס
async function askGemini(key: string, model: string, mime: string, data: string, ms: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
            // בלי "חשיבה" בדגמי 2.5: מהיר הרבה יותר, ומספיק לקריאת טקסט
            ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      },
    );
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 504, body: { error: "timeout " + model } };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  if (!(await isOwner(req.headers.get("Authorization") || ""))) {
    return json({ error: "not_owner" }, 403);
  }

  // השם המומלץ הוא GEMINI_API_KEY, אבל מקבלים גם שם קרוב (למשל GEMINI_KEY או GOOGLE_API_KEY)
  const env = Deno.env.toObject();
  const SYSTEM = /^(SUPABASE_|SB_|DENO_|PATH$|HOME$|HOSTNAME$|PWD$|LANG$)/;
  const custom = Object.keys(env).filter((k) => !SYSTEM.test(k));
  const keyName = ["GEMINI_API_KEY", ...custom.filter((k) => /GEMINI/i.test(k)), ...custom.filter((k) => /GOOGLE|GENAI|AI_STUDIO/i.test(k)), ...custom.filter((k) => /^\s*AIza/.test(env[k] || "")), ...custom.filter((k) => /^API[_ ]?KEY$/i.test(k.trim()))]
    .find((k) => env[k] && env[k].trim());
  const key = keyName ? env[keyName].trim() : "";
  if (!key) {
    console.error("no gemini key; custom secret names:", custom.join(", ") || "(none)");
    return json({ error: "no_key" }, 503);
  }

  let input: { image?: string; mime?: string };
  try { input = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const data = String(input.image || "").replace(/^data:[^,]*,/, "");
  const mime = /^image\/(jpeg|png|webp)$/.test(String(input.mime)) ? String(input.mime) : "image/jpeg";
  if (!data || data.length > 8_000_000) return json({ error: "bad_image" }, 400);

  // אם מודל עמוס / איטי / לא קיים, עוברים למודל הבא. סה"כ עד כ-45 שניות.
  // גוגל מחליפים דגמים מדי פעם; אם אחד לא קיים (404) או עמוס (503) עוברים לבא.
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash"]
    .filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  const started = Date.now();
  const RETRY = [404, 429, 500, 503, 504];

  let last = { ok: false, status: 0, body: {} as Record<string, unknown> };
  for (const model of models) {
    const left = 45000 - (Date.now() - started);
    if (left < 4000) break;
    last = await askGemini(key, model, mime, data, Math.min(18000, left));
    if (last.ok) break;
    if (last.status === 503 && Date.now() - started < 30000) {
      // עומס רגעי: ניסיון אחד נוסף אחרי הפסקה קצרה
      await new Promise((r) => setTimeout(r, 1500));
      last = await askGemini(key, model, mime, data, Math.min(18000, 45000 - (Date.now() - started)));
      if (last.ok) break;
    }
    console.error("gemini", model, last.status, JSON.stringify(last.body).slice(0, 300));
    if (!RETRY.includes(last.status) && !(last.status === 400 && !/api.?key/i.test(JSON.stringify(last.body)))) break;
  }
  if (!last.ok) {
    const keyProblem = /api.?key/i.test(JSON.stringify(last.body));
    const code = last.status === 429 ? "quota" : ((last.status === 400 || last.status === 403) && keyProblem) ? "bad_key"
      : [500, 503, 504].includes(last.status) ? "busy" : "gemini";
    console.error("gemini error", last.status, JSON.stringify(last.body).slice(0, 500));
    return json({ error: code }, 502);
  }

  try {
    // deno-lint-ignore no-explicit-any
    const b = last.body as any;
    const txt = b.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "{}";
    const out = JSON.parse(txt);
    const stars = Math.round(Number(out.stars));
    return json({
      author: String(out.author || "").trim().slice(0, 60),
      stars: stars >= 1 && stars <= 5 ? stars : 5,
      text: String(out.text || "").trim().slice(0, 2000),
    });
  } catch {
    return json({ error: "unreadable" }, 422);
  }
});
