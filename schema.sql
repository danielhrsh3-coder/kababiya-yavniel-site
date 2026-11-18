-- schema.sql - הקמת מסד הנתונים של האתר (Supabase)
-- איך מריצים: ב-Supabase נכנסים ל-SQL Editor, מדביקים את כל הקובץ הזה ולוחצים Run.
-- אפשר להריץ שוב בלי פחד: מה שכבר קיים לא נמחק ולא מוכפל.

-- 1. טבלת המנות ----------------------------------------------------------
create table if not exists public.dishes (
  id           uuid primary key default gen_random_uuid(),
  cat          text not null check (cat in ('grill','hummus','sides','drinks')),
  name         text not null,
  note         text not null default '',
  image        text not null default '',
  placeholder  text not null default '',
  prices       jsonb not null default '[]'::jsonb,   -- [{"label":"פיתה","price":42}, ...]
  sort         integer not null default 0,
  visible      boolean not null default true,
  special_date date,                                  -- ספיישל: מופיע מהתאריך הזה
  special_until date,                                 -- ספיישל לכמה ימים: עד התאריך הזה (ריק = יום אחד)
  created_at   timestamptz not null default now()
);

-- 2. הגדרות האתר (הודעה קופצת, סלטים ורטבים) - שורה אחת בלבד ------------
create table if not exists public.site_settings (
  id            integer primary key default 1 check (id = 1),
  popup_enabled boolean not null default false,
  popup_text    text not null default '',
  popup_until   date,
  popup_image   text not null default '',
  salads        text,
  sauces        text
);

-- 2ב. חוות דעת על העסק -----------------------------------------------------
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  author     text not null default '',
  text       text not null,
  stars      smallint not null default 5 check (stars between 1 and 5),
  source     text not null default '',
  url        text not null default '',
  sort       integer not null default 0,
  visible    boolean not null default true,
  created_at timestamptz not null default now()
);

-- אם כבר הרצת גרסה קודמת של הקובץ, השורות האלה מוסיפות את מה שחסר
alter table public.dishes        add column if not exists special_until date;
alter table public.site_settings add column if not exists popup_image text not null default '';
alter table public.reviews       add column if not exists url text not null default '';

-- 3. הרשאות: כולם קוראים, רק בעל העסק (משתמש מחובר) כותב ------------------
alter table public.dishes        enable row level security;
alter table public.site_settings enable row level security;
alter table public.reviews       enable row level security;

drop policy if exists "dishes public read"  on public.dishes;
drop policy if exists "dishes owner all"    on public.dishes;
drop policy if exists "settings public read" on public.site_settings;
drop policy if exists "settings owner all"   on public.site_settings;
drop policy if exists "reviews public read"  on public.reviews;
drop policy if exists "reviews owner all"    on public.reviews;

create policy "dishes public read"   on public.dishes
  for select to anon using (visible = true);
create policy "dishes owner all"     on public.dishes
  for all to authenticated using (true) with check (true);
create policy "settings public read" on public.site_settings
  for select to anon using (true);
create policy "settings owner all"   on public.site_settings
  for all to authenticated using (true) with check (true);
create policy "reviews public read"  on public.reviews
  for select to anon using (visible = true);
create policy "reviews owner all"    on public.reviews
  for all to authenticated using (true) with check (true);

-- 4. אחסון תמונות ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('dish-images', 'dish-images', true)
on conflict (id) do nothing;

drop policy if exists "dish images owner upload" on storage.objects;
drop policy if exists "dish images owner update" on storage.objects;
drop policy if exists "dish images owner delete" on storage.objects;

create policy "dish images owner upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'dish-images');
create policy "dish images owner update" on storage.objects
  for update to authenticated using (bucket_id = 'dish-images');
create policy "dish images owner delete" on storage.objects
  for delete to authenticated using (bucket_id = 'dish-images');

-- 5. התפריט הקיים (מוכנס רק אם הטבלה עדיין ריקה) ---------------------------
insert into public.dishes (cat, name, note, image, placeholder, prices, sort)
select * from (values
  ('hummus', 'חומוס פשוט / עם גרגירי חומוס', '', '', 'hummus', '[{"label":"","price":35}]'::jsonb, 10),
  ('hummus', 'חומוס עם תוספת בשר / פטריות / רצועות עוף', '', '', 'hummus', '[{"label":"","price":45}]'::jsonb, 20),
  ('hummus', 'פלאפל בפיתה', '', '', 'falafel', '[{"label":"","price":18}]'::jsonb, 30),
  ('hummus', 'פלאפל + ציפס + שתייה', '', '', 'falafel', '[{"label":"","price":25}]'::jsonb, 40),
  ('grill', 'המבורגר', 'קציצה נוספת +10 ₪', 'images/burger.jpg', '', '[{"label":"","price":45}]'::jsonb, 50),
  ('grill', 'עראייס', '', 'images/arayes.jpg', '', '[{"label":"","price":42}]'::jsonb, 60),
  ('grill', 'מנת "הקבביה"', '', 'images/kababiya.jpg', '', '[{"label":"","price":42}]'::jsonb, 70),
  ('grill', 'קבב', '', '', 'kabab', '[{"label":"פיתה","price":42},{"label":"בגט","price":50},{"label":"צלחת","price":55}]'::jsonb, 80),
  ('grill', 'אנטריקוט', '', '', 'entrecote', '[{"label":"פיתה","price":42},{"label":"בגט","price":50}]'::jsonb, 90),
  ('grill', 'חזה עוף', '', 'images/chicken.jpg', '', '[{"label":"פיתה","price":42},{"label":"בגט","price":50},{"label":"צלחת","price":55}]'::jsonb, 100),
  ('grill', 'שניצל', '', 'images/schnitzel.jpg', '', '[{"label":"פיתה","price":42},{"label":"בגט","price":50},{"label":"צלחת","price":55}]'::jsonb, 110),
  ('grill', 'נקנקיות מרגז', '', 'images/merguez.jpg', '', '[{"label":"","price":42}]'::jsonb, 120),
  ('sides', 'ציפס', '', '', '', '[{"label":"","price":12}]'::jsonb, 130),
  ('sides', 'טבעות בצל', '', '', '', '[{"label":"","price":15}]'::jsonb, 140),
  ('sides', 'מיקס טבעות בצל וציפס', '', '', '', '[{"label":"","price":20}]'::jsonb, 150),
  ('drinks', 'שתייה קלה', '', '', '', '[{"label":"","price":7}]'::jsonb, 160),
  ('drinks', 'בירה', '', '', '', '[{"label":"","price":10}]'::jsonb, 170)
) as seed(cat, name, note, image, placeholder, prices, sort)
where not exists (select 1 from public.dishes);

insert into public.site_settings (id, salads, sauces)
values (1, 'עגבניות · מלפפונים · חמוצים · חסה · סלט חריף · מטבוחה · חומוס · בצל · חריף · כרוב לבן', 'שום · אלף האיים · שזיפים · צ''ילי מתוק · עמבה · ברביקיו · מיונז · טחינה · קטשופ')
on conflict (id) do nothing;
