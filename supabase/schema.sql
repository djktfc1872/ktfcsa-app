-- ===========================================================================
-- KTFCSA Away Days - database schema
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste
-- the whole file -> Run. It is safe to run again; everything is guarded.
--
-- Fixtures are pushed in by the GitHub Action, so scoring a prediction never
-- depends on trusting a supporter's browser.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles

create table if not exists profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table profiles is 'One row per supporter. is_admin is set by hand in the dashboard.';

-- A profile is created automatically the moment somebody signs up, using the
-- display name they typed on the sign-up form.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Supporter')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- fixtures

create table if not exists fixtures (
  id             text primary key,          -- the Southern League match id
  match_date     date not null,
  kickoff        text,
  kickoff_at     timestamptz,               -- date + kick-off, UK time
  venue          text not null,             -- 'Home' or 'Away'
  opponent       text not null,
  opponent_slug  text,
  competition    text,
  competition_type text,
  status         text not null default 'upcoming',  -- upcoming/live/played/off
  home_score     int,
  away_score     int,
  distance_miles int,                       -- from the master spreadsheet
  updated_at     timestamptz not null default now()
);

create index if not exists fixtures_date_idx on fixtures (match_date);

comment on column fixtures.kickoff_at is
  'Used to lock predictions. Rewritten on every sync, so a rescheduled game reopens on its own.';

-- ------------------------------------------------------------- predictions

create table if not exists predictions (
  profile_id  uuid not null references profiles on delete cascade,
  fixture_id  text not null references fixtures on delete cascade,
  home_score  int  not null check (home_score  between 0 and 20),
  away_score  int  not null check (away_score  between 0 and 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, fixture_id)
);

-- -------------------------------------------------------------- attendance

create table if not exists attendance (
  profile_id uuid not null references profiles on delete cascade,
  fixture_id text not null references fixtures on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, fixture_id)
);

-- -------------------------------------------------------- pub suggestions

create table if not exists pubs (
  id          uuid primary key default gen_random_uuid(),
  club_slug   text not null,
  profile_id  uuid references profiles on delete set null,
  author_name text not null,
  name        text not null check (char_length(name) between 2 and 80),
  postcode    text check (char_length(postcode) <= 12),
  notes       text check (char_length(notes) <= 400),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists pubs_club_idx on pubs (club_slug);

create table if not exists pub_votes (
  pub_id     uuid not null references pubs on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  primary key (pub_id, profile_id)
);

-- --------------------------------------------------------------- feedback

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles on delete set null,
  author_name text,
  contact     text check (char_length(contact) <= 80),
  topic       text not null check (topic in ('works-well', 'needs-work', 'idea', 'problem', 'other')),
  message     text not null check (char_length(message) between 4 and 1000),
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table feedback is
  'Supporter feedback for the KTFCSA team. Read it in the Table Editor and tick handled.';

-- ------------------------------------------------------------ the boards

create table if not exists coach_notices (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references profiles on delete set null,
  author_name  text not null,
  fixture_id   text references fixtures on delete set null,
  fixture_label text,
  fixture_date date,
  departs      text,
  pickup       text,
  price        text,
  contact      text,
  notes        text not null check (char_length(notes) <= 600),
  created_at   timestamptz not null default now()
);

create table if not exists lifts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles on delete cascade,
  author_name   text not null,
  kind          text not null check (kind in ('offer', 'request')),
  fixture_id    text references fixtures on delete set null,
  fixture_label text,
  fixture_date  date,
  area          text check (char_length(area) <= 60),
  leaving       text check (char_length(leaving) <= 20),
  seats         text check (char_length(seats) <= 4),
  contact       text check (char_length(contact) <= 60),
  notes         text check (char_length(notes) <= 400),
  created_at    timestamptz not null default now()
);

create table if not exists wall_posts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles on delete cascade,
  author_name text not null,
  text        text not null check (char_length(text) between 1 and 600),
  thread      text,               -- 'pre:<fixture id>' or 'post:<fixture id>'
  likes       int not null default 0,
  reports     int not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Existing installs get the column without losing anything.
alter table wall_posts add column if not exists thread text;

create index if not exists wall_thread_idx on wall_posts (thread, created_at desc);

comment on column wall_posts.thread is
  'Null for the open wall. Match threads are worked out from the fixture list, so they need no rows of their own.';

create table if not exists polls (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles on delete set null,
  author_name text not null,
  question    text not null check (char_length(question) between 5 and 120),
  options     jsonb not null,          -- ["Novak", "Whitfield"]
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists poll_votes (
  poll_id      uuid not null references polls on delete cascade,
  profile_id   uuid not null references profiles on delete cascade,
  option_index int  not null check (option_index >= 0),
  created_at   timestamptz not null default now(),
  primary key (poll_id, profile_id)
);

-- ===========================================================================
-- Views. These do the counting, so no scheduled job is needed.
-- ===========================================================================

-- Three points for the exact score, one for the right result.
create or replace view prediction_league as
select
  pr.id                                          as profile_id,
  pr.display_name,
  count(*)                                       as played,
  sum(
    case
      when p.home_score = f.home_score and p.away_score = f.away_score then 3
      when sign(p.home_score - p.away_score) = sign(f.home_score - f.away_score) then 1
      else 0
    end
  )::int                                         as points,
  count(*) filter (
    where p.home_score = f.home_score and p.away_score = f.away_score
  )::int                                         as exact_scores
from predictions p
join fixtures f  on f.id = p.fixture_id
join profiles pr on pr.id = p.profile_id
where f.status = 'played'
  and f.home_score is not null
  and f.away_score is not null
group by pr.id, pr.display_name;

comment on view prediction_league is 'Live prediction table. Recalculates as results land.';

-- Games attended, and the miles clocked up getting to the away ones.
create or replace view attendance_summary as
select
  pr.id                                                   as profile_id,
  pr.display_name,
  count(*)                                                as games,
  count(*) filter (where f.venue = 'Home')::int           as home_games,
  count(*) filter (where f.venue = 'Away')::int           as away_games,
  coalesce(sum(
    case when f.venue = 'Away' then f.distance_miles * 2 else 0 end
  ), 0)::int                                              as miles
from attendance a
join fixtures f  on f.id = a.fixture_id
join profiles pr on pr.id = a.profile_id
group by pr.id, pr.display_name;

comment on view attendance_summary is 'Miles counts the return trip to away grounds.';

-- Poll results without exposing who voted for what.
create or replace view poll_results as
select poll_id, option_index, count(*)::int as votes
from poll_votes
group by poll_id, option_index;

-- Pub suggestions with their vote counts.
create or replace view pub_list as
select p.*, coalesce(v.votes, 0)::int as votes
from pubs p
left join (
  select pub_id, count(*) as votes from pub_votes group by pub_id
) v on v.pub_id = p.id
where p.hidden = false;

-- ===========================================================================
-- Row level security. Nothing is readable or writable until a policy says so.
-- ===========================================================================

alter table profiles      enable row level security;
alter table fixtures      enable row level security;
alter table predictions   enable row level security;
alter table attendance    enable row level security;
alter table pubs          enable row level security;
alter table pub_votes     enable row level security;
alter table coach_notices enable row level security;
alter table lifts         enable row level security;
alter table wall_posts    enable row level security;
alter table polls         enable row level security;
alter table feedback      enable row level security;
alter table poll_votes    enable row level security;

-- Is the person making this request a volunteers member?
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Has this fixture kicked off yet?
create or replace function fixture_open(fid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select kickoff_at > now() from fixtures where id = fid),
    false
  );
$$;

-- ---- profiles -------------------------------------------------------------
drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and is_admin = (select is_admin from profiles where id = auth.uid()));

-- ---- fixtures -------------------------------------------------------------
-- Read-only to everyone. Only the sync job, which uses the service role key
-- and bypasses these policies, ever writes here.
drop policy if exists "fixtures readable" on fixtures;
create policy "fixtures readable" on fixtures for select using (true);

-- ---- predictions ----------------------------------------------------------
drop policy if exists "predictions readable" on predictions;
create policy "predictions readable" on predictions
  for select using (auth.role() = 'authenticated');

drop policy if exists "predict before kick-off" on predictions;
create policy "predict before kick-off" on predictions
  for insert with check (auth.uid() = profile_id and fixture_open(fixture_id));

drop policy if exists "change prediction before kick-off" on predictions;
create policy "change prediction before kick-off" on predictions
  for update using (auth.uid() = profile_id and fixture_open(fixture_id))
  with check (auth.uid() = profile_id and fixture_open(fixture_id));

drop policy if exists "withdraw prediction before kick-off" on predictions;
create policy "withdraw prediction before kick-off" on predictions
  for delete using (auth.uid() = profile_id and fixture_open(fixture_id));

-- ---- attendance -----------------------------------------------------------
drop policy if exists "attendance readable" on attendance;
create policy "attendance readable" on attendance
  for select using (auth.role() = 'authenticated');

drop policy if exists "own attendance" on attendance;
create policy "own attendance" on attendance
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ---- pubs -----------------------------------------------------------------
drop policy if exists "pubs readable" on pubs;
create policy "pubs readable" on pubs
  for select using (hidden = false or is_admin());

drop policy if exists "suggest a pub" on pubs;
create policy "suggest a pub" on pubs
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own pub" on pubs;
create policy "edit own pub" on pubs
  for update using (auth.uid() = profile_id or is_admin());

drop policy if exists "remove own pub" on pubs;
create policy "remove own pub" on pubs
  for delete using (auth.uid() = profile_id or is_admin());

drop policy if exists "pub votes readable" on pub_votes;
create policy "pub votes readable" on pub_votes
  for select using (auth.role() = 'authenticated');

drop policy if exists "own pub vote" on pub_votes;
create policy "own pub vote" on pub_votes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ---- feedback -------------------------------------------------------------
-- Anyone, signed in or not, may send feedback. Only the KTFCSA team reads it,
-- so one supporter can never see another's message.
drop policy if exists "send feedback" on feedback;
create policy "send feedback" on feedback for insert with check (true);

drop policy if exists "volunteers reads feedback" on feedback;
create policy "volunteers reads feedback" on feedback for select using (is_admin());

drop policy if exists "volunteers updates feedback" on feedback;
create policy "volunteers updates feedback" on feedback for update using (is_admin());

drop policy if exists "volunteers removes feedback" on feedback;
create policy "volunteers removes feedback" on feedback for delete using (is_admin());

-- ---- coach notices --------------------------------------------------------
drop policy if exists "coach readable" on coach_notices;
create policy "coach readable" on coach_notices for select using (true);

drop policy if exists "volunteers posts coach" on coach_notices;
create policy "volunteers posts coach" on coach_notices
  for insert with check (is_admin() and auth.uid() = profile_id);

drop policy if exists "volunteers edits coach" on coach_notices;
create policy "volunteers edits coach" on coach_notices for update using (is_admin());

drop policy if exists "volunteers removes coach" on coach_notices;
create policy "volunteers removes coach" on coach_notices for delete using (is_admin());

-- ---- lifts ----------------------------------------------------------------
drop policy if exists "lifts readable" on lifts;
create policy "lifts readable" on lifts
  for select using (auth.role() = 'authenticated');

drop policy if exists "post own lift" on lifts;
create policy "post own lift" on lifts
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own lift" on lifts;
create policy "edit own lift" on lifts
  for update using (auth.uid() = profile_id or is_admin());

drop policy if exists "remove own lift" on lifts;
create policy "remove own lift" on lifts
  for delete using (auth.uid() = profile_id or is_admin());

-- ---- wall -----------------------------------------------------------------
drop policy if exists "wall readable" on wall_posts;
create policy "wall readable" on wall_posts
  for select using (hidden = false or is_admin());

drop policy if exists "post to wall" on wall_posts;
create policy "post to wall" on wall_posts
  for insert with check (auth.uid() = profile_id);

-- A supporter may edit their own post. Anyone signed in may nudge the likes
-- and reports counters. Only the KTFCSA team can hide something.
drop policy if exists "update wall post" on wall_posts;
create policy "update wall post" on wall_posts
  for update using (auth.uid() = profile_id or is_admin() or auth.role() = 'authenticated');

drop policy if exists "remove wall post" on wall_posts;
create policy "remove wall post" on wall_posts
  for delete using (auth.uid() = profile_id or is_admin());

-- ---- polls ----------------------------------------------------------------
drop policy if exists "polls readable" on polls;
create policy "polls readable" on polls for select using (true);

drop policy if exists "volunteers creates polls" on polls;
create policy "volunteers creates polls" on polls
  for insert with check (is_admin() and auth.uid() = profile_id);

drop policy if exists "volunteers edits polls" on polls;
create policy "volunteers edits polls" on polls for update using (is_admin());

drop policy if exists "volunteers closes polls" on polls;
create policy "volunteers closes polls" on polls for delete using (is_admin());

drop policy if exists "poll votes readable" on poll_votes;
create policy "poll votes readable" on poll_votes
  for select using (auth.role() = 'authenticated');

drop policy if exists "vote once" on poll_votes;
create policy "vote once" on poll_votes
  for insert with check (auth.uid() = profile_id);

-- ===========================================================================
-- Make the views obey the same rules as the tables underneath them.
-- ===========================================================================
alter view prediction_league  set (security_invoker = true);
alter view attendance_summary set (security_invoker = true);
alter view poll_results       set (security_invoker = true);
alter view pub_list           set (security_invoker = true);

grant select on prediction_league, attendance_summary, poll_results, pub_list to anon, authenticated;
