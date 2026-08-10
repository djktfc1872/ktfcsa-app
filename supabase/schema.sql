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

-- ------------------------------------------------------ access reports
--
-- There is no usable source for this at Step 3. OpenStreetMap has almost
-- nothing, Level Playing Field covers the bigger clubs, and the club sites
-- are inconsistent. Guessing would be worse than saying nothing, because a
-- disabled supporter travelling on bad information is the one person we
-- really cannot let down. So it comes from fans who have actually been.
--
-- Every field allows "not sure", and the app says plainly when nobody has
-- reported on a ground yet.

create table if not exists access_reports (
  id                uuid primary key default gen_random_uuid(),
  club_slug         text not null,
  profile_id        uuid references profiles on delete set null,
  author_name       text not null,
  step_free         text check (step_free         in ('yes','no','unsure')) default 'unsure',
  accessible_toilet text check (accessible_toilet in ('yes','no','unsure')) default 'unsure',
  wheelchair_spaces text check (wheelchair_spaces in ('yes','no','unsure')) default 'unsure',
  blue_badge_parking text check (blue_badge_parking in ('yes','no','unsure')) default 'unsure',
  carer_free        text check (carer_free        in ('yes','no','unsure')) default 'unsure',
  notes             text check (char_length(notes) <= 500),
  visited_on        date,
  hidden            boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists access_club_idx on access_reports (club_slug, created_at desc);

-- ------------------------------------------------------- ground reports
--
-- The practical stuff a visiting fan wants to know and nobody publishes:
-- whether you can stay dry, whether they take a card, whether there is a cup
-- of tea. Wikipedia's ground sections are club history rather than anything
-- useful on the day, and Wikidata had a linked venue for one club in six,
-- which turned out to be a ground we left years ago. So this comes from fans
-- as well.

create table if not exists ground_reports (
  id             uuid primary key default gen_random_uuid(),
  club_slug      text not null,
  profile_id     uuid references profiles on delete set null,
  author_name    text not null,
  covered        text check (covered      in ('yes','no','unsure')) default 'unsure',
  seating        text check (seating      in ('yes','no','unsure')) default 'unsure',
  surface        text check (surface      in ('grass','3g','unsure')) default 'unsure',
  card_payments  text check (card_payments in ('yes','no','unsure')) default 'unsure',
  refreshments   text check (refreshments in ('yes','no','unsure')) default 'unsure',
  bar            text check (bar          in ('yes','no','unsure')) default 'unsure',
  dogs           text check (dogs         in ('yes','no','unsure')) default 'unsure',
  notes          text check (char_length(notes) <= 500),
  visited_on     date,
  hidden         boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists ground_club_idx on ground_reports (club_slug, created_at desc);

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
-- Readable by anyone. A guest could already see who had filed a ground report,
-- because that table is public, so an admin showed up tagged Contributor and
-- never Admin: the worst of both, since it mislabelled them. The columns here
-- are a display name that already appears on every post, a badge the supporter
-- chose, and whether they help run the site. No email and no auth data.
create policy "profiles readable" on profiles
  for select using (true);

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
-- Was "with check (true)", which let anyone holding the anon key, and it ships
-- in the app, write as many rows as they liked and put another supporter's
-- profile_id on them. Feedback now needs an account and can only be sent as
-- yourself. Anyone signed out is pointed at the email address instead.
create policy "send feedback" on feedback
  for insert with check (auth.uid() is not null and profile_id = auth.uid());

drop policy if exists "volunteers reads feedback" on feedback;
create policy "volunteers reads feedback" on feedback for select using (is_admin());

drop policy if exists "volunteers updates feedback" on feedback;
create policy "volunteers updates feedback" on feedback for update using (is_admin());

drop policy if exists "volunteers removes feedback" on feedback;
create policy "volunteers removes feedback" on feedback for delete using (is_admin());


-- ---- access reports -------------------------------------------------------
alter table access_reports enable row level security;

drop policy if exists "access readable" on access_reports;
create policy "access readable" on access_reports
  for select using (hidden = false or is_admin());

drop policy if exists "report access" on access_reports;
create policy "report access" on access_reports
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own access report" on access_reports;
create policy "edit own access report" on access_reports
  for update using (auth.uid() = profile_id or is_admin());

drop policy if exists "remove own access report" on access_reports;
create policy "remove own access report" on access_reports
  for delete using (auth.uid() = profile_id or is_admin());


-- ---- ground reports -------------------------------------------------------
alter table ground_reports enable row level security;

drop policy if exists "ground readable" on ground_reports;
create policy "ground readable" on ground_reports
  for select using (hidden = false or is_admin());

drop policy if exists "report ground" on ground_reports;
create policy "report ground" on ground_reports
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own ground report" on ground_reports;
create policy "edit own ground report" on ground_reports
  for update using (auth.uid() = profile_id or is_admin());

drop policy if exists "remove own ground report" on ground_reports;
create policy "remove own ground report" on ground_reports
  for delete using (auth.uid() = profile_id or is_admin());

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

-- ===========================================================================
-- Player ratings
--
-- The league's own feed names the eleven and the substitutes for most matches,
-- so the squad builds itself as the season goes on. Coverage does slip, so
-- volunteers can type a team sheet in by hand when it does: that is what
-- lineups is for. Ratings are one row per supporter, per player, per match.
-- ===========================================================================

create table if not exists lineups (
  fixture_id text primary key references fixtures on delete cascade,
  players    jsonb not null default '[]'::jsonb,
  posted_by  uuid references profiles on delete set null,
  updated_at timestamptz not null default now()
);

comment on table lineups is
  'A team sheet entered by a volunteer, used when the league feed has none.';

create table if not exists player_ratings (
  profile_id  uuid not null references profiles on delete cascade,
  fixture_id  text not null references fixtures on delete cascade,
  player_name text not null check (char_length(player_name) between 2 and 60),
  rating      int  not null check (rating between 1 and 10),
  created_at  timestamptz not null default now(),
  primary key (profile_id, fixture_id, player_name)
);

create index if not exists ratings_fixture_idx on player_ratings (fixture_id);

-- True once a match has kicked off. Nobody rates a player before they play.
create or replace function has_kicked_off(fixture text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from fixtures
    where id = fixture and kickoff_at is not null and kickoff_at <= now()
  );
$$;

-- What a player scored in one match, and how many supporters said so.
create or replace view match_ratings as
select
  fixture_id,
  player_name,
  round(avg(rating)::numeric, 1) as average,
  count(*)::int                  as voters
from player_ratings
group by fixture_id, player_name;

-- A player's season so far. Every match they were rated in counts once.
create or replace view season_ratings as
select
  player_name,
  round(avg(average)::numeric, 1) as average,
  count(*)::int                   as matches,
  sum(voters)::int                as voters
from match_ratings
group by player_name;

alter table lineups        enable row level security;
alter table player_ratings enable row level security;

drop policy if exists "lineups readable" on lineups;
create policy "lineups readable" on lineups for select using (true);

drop policy if exists "volunteers posts a lineup" on lineups;
create policy "volunteers posts a lineup" on lineups
  for insert with check (is_admin());

drop policy if exists "volunteers edits a lineup" on lineups;
create policy "volunteers edits a lineup" on lineups
  for update using (is_admin()) with check (is_admin());

drop policy if exists "volunteers removes a lineup" on lineups;
create policy "volunteers removes a lineup" on lineups
  for delete using (is_admin());

drop policy if exists "ratings readable" on player_ratings;
create policy "ratings readable" on player_ratings for select using (true);

drop policy if exists "rate after kick-off" on player_ratings;
create policy "rate after kick-off" on player_ratings
  for insert with check (auth.uid() = profile_id and has_kicked_off(fixture_id));

drop policy if exists "change own rating" on player_ratings;
create policy "change own rating" on player_ratings
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "withdraw own rating" on player_ratings;
create policy "withdraw own rating" on player_ratings
  for delete using (auth.uid() = profile_id or is_admin());

alter view match_ratings  set (security_invoker = true);
alter view season_ratings set (security_invoker = true);

grant select on match_ratings, season_ratings to anon, authenticated;

-- ===========================================================================
-- Profile emblems
--
-- A supporter can pick a small badge instead of their initials. It is a short
-- string naming one of a fixed set the app ships, never an uploaded file, so
-- there is nothing to host and nothing to moderate.
-- ===========================================================================

alter table profiles add column if not exists avatar text
  check (avatar is null or char_length(avatar) <= 16);

-- ===========================================================================
-- Ticket price reports
--
-- Only two clubs in the division publish admission prices anywhere a script
-- can read, and both were wrong in our data when first checked. The supporter
-- who has just paid at the turnstile is the most reliable source there is.
-- ===========================================================================

create table if not exists price_reports (
  id          uuid primary key default gen_random_uuid(),
  club_slug   text not null,
  profile_id  uuid references profiles on delete set null,
  author_name text not null,
  adult       numeric(5,2) check (adult is null or adult between 0 and 60),
  concession  numeric(5,2) check (concession is null or concession between 0 and 60),
  paid_on     date,
  notes       text check (notes is null or char_length(notes) <= 300),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists price_club_idx on price_reports (club_slug, created_at desc);

alter table price_reports enable row level security;

drop policy if exists "prices readable" on price_reports;
create policy "prices readable" on price_reports
  for select using (hidden = false or is_admin());

drop policy if exists "report a price" on price_reports;
create policy "report a price" on price_reports
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own price report" on price_reports;
create policy "edit own price report" on price_reports
  for update using (auth.uid() = profile_id or is_admin());

drop policy if exists "remove own price report" on price_reports;
create policy "remove own price report" on price_reports
  for delete using (auth.uid() = profile_id or is_admin());

-- ===========================================================================
-- Replies on the fan wall
--
-- A wall of separate posts is a noticeboard, not a conversation. A reply is
-- just a post that points at another one, so it inherits every rule already
-- written: the same word filter, the same reporting, the same hiding.
-- ===========================================================================

alter table wall_posts add column if not exists reply_to uuid
  references wall_posts (id) on delete cascade;

create index if not exists wall_reply_idx on wall_posts (reply_to, created_at);

-- A reply cannot itself be replied to. One level deep stays readable on a
-- phone and nobody loses the thread.
create or replace function reply_is_top_level()
returns trigger
language plpgsql
as $$
begin
  if new.reply_to is not null
     and exists (select 1 from wall_posts where id = new.reply_to and reply_to is not null)
  then
    raise exception 'Replies only go one level deep';
  end if;
  return new;
end;
$$;

drop trigger if exists wall_reply_depth on wall_posts;
create trigger wall_reply_depth
  before insert or update on wall_posts
  for each row execute function reply_is_top_level();

-- ===========================================================================
-- Admin panel
--
-- A tag a volunteer can hand out, and a set of counts for the people running
-- the site. The Contributor tag was worked out from whether somebody had filed
-- a ground report, which is fine as a default but cannot recognise a
-- contribution made anywhere else: Darren Young wrote every player pen pic and
-- had filed nothing.
-- ===========================================================================

alter table profiles add column if not exists tag text
  check (tag is null or tag in ('contributor', 'volunteer', 'reporter', 'photographer', 'legend'));

/* Setting a tag is separated out rather than done through a policy that lets
   an admin update any profile row. A broad update policy would also let one
   admin make somebody else an admin, which is a bigger power than handing out
   a label. This touches the tag column and nothing else. */
create or replace function set_user_tag(target uuid, new_tag text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can set a tag';
  end if;
  if new_tag is not null and new_tag not in ('contributor', 'volunteer', 'reporter', 'photographer', 'legend') then
    raise exception 'Unknown tag';
  end if;
  update profiles set tag = new_tag where id = target;
end;
$$;

revoke all on function set_user_tag(uuid, text) from public;
grant execute on function set_user_tag(uuid, text) to authenticated;

-- What the people running the site can see at a glance. Counts only, no
-- reading of anybody's messages.
create or replace view admin_overview as
select * from (
select
  (select count(*) from profiles)                                  as supporters,
  (select count(*) from profiles where created_at > now() - interval '7 days') as supporters_this_week,
  (select count(*) from wall_posts where hidden = false)           as posts,
  (select count(*) from wall_posts where reply_to is not null and hidden = false) as replies,
  (select count(*) from player_ratings)                            as ratings,
  (select count(*) from predictions)                               as predictions,
  (select count(*) from attendance)                                as attendances,
  (select count(*) from ground_reports where hidden = false)       as ground_reports,
  (select count(*) from access_reports where hidden = false)       as access_reports,
  (select count(*) from price_reports where hidden = false)        as price_reports,
  (select count(*) from pubs where hidden = false)                 as pubs,
  (select count(*) from feedback where handled = false)            as feedback_waiting
) counts
/* Returns nothing at all to anyone who is not a volunteer, rather than
   handing out most of the numbers and hiding one. */
where is_admin();

alter view admin_overview set (security_invoker = true);
grant select on admin_overview to authenticated;
