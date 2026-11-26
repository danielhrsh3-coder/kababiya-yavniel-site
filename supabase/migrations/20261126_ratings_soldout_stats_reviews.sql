-- הוחל על הפרויקט החי ב-26.11.2026. נשמר כאן לתיעוד.
alter table public.dishes add column if not exists sold_out boolean not null default false;
alter table public.reviews add column if not exists from_screenshot boolean not null default false;

create table if not exists public.dish_votes (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists dish_votes_dish_idx on public.dish_votes(dish_id);
create index if not exists dish_votes_created_idx on public.dish_votes(created_at);
alter table public.dish_votes enable row level security;
create policy "votes public insert" on public.dish_votes for insert to anon, authenticated
  with check (score between 1 and 5 and (comment = '' or score <= 3));
create policy "votes owner read" on public.dish_votes for select to authenticated using (public.is_owner());
create policy "votes owner delete" on public.dish_votes for delete to authenticated using (public.is_owner());

create or replace function public.dish_votes_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.dish_votes where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many votes, try again later' using errcode = 'P0001';
  end if;
  return new;
end; $$;
create trigger dish_votes_rate_limit before insert on public.dish_votes
  for each row execute function public.dish_votes_rate_limit();

create or replace function public.top_dishes()
returns table(dish_id uuid, rank int, avg_score numeric, votes int)
language sql stable security definer set search_path = '' as $$
  select t.dish_id, (row_number() over (order by t.a desc, t.n desc))::int, t.a, t.n
  from (
    select v.dish_id, round(avg(v.score)::numeric, 2) as a, count(*)::int as n
    from public.dish_votes v join public.dishes d on d.id = v.dish_id
    where v.score >= 3 and d.visible
    group by v.dish_id
    having count(*) >= 5
  ) t
  order by 2
  limit 3;
$$;
grant execute on function public.top_dishes() to anon, authenticated;

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('visit','waze','whatsapp','call')),
  created_at timestamptz not null default now()
);
create index if not exists site_events_created_idx on public.site_events(created_at);
alter table public.site_events enable row level security;
create policy "events public insert" on public.site_events for insert to anon, authenticated with check (true);
create policy "events owner read" on public.site_events for select to authenticated using (public.is_owner());

create or replace function public.site_events_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.site_events where created_at > now() - interval '1 hour') >= 5000 then
    raise exception 'too many events' using errcode = 'P0001';
  end if;
  return new;
end; $$;
create trigger site_events_rate_limit before insert on public.site_events
  for each row execute function public.site_events_rate_limit();

create or replace function public.owner_event_days(p_from date)
returns table(day date, kind text, n int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select (e.created_at at time zone 'Asia/Jerusalem')::date, e.kind, count(*)::int
    from public.site_events e
    where e.created_at >= (p_from::timestamp at time zone 'Asia/Jerusalem')
    group by 1, 2;
end; $$;
revoke execute on function public.owner_event_days(date) from public, anon;
grant execute on function public.owner_event_days(date) to authenticated;

grant insert on public.dish_votes, public.site_events to anon, authenticated;
grant select, delete on public.dish_votes to authenticated;
grant select on public.site_events to authenticated;

revoke execute on function public.dish_votes_rate_limit() from public, anon, authenticated;
revoke execute on function public.site_events_rate_limit() from public, anon, authenticated;
