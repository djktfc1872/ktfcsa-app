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
  with check (
    auth.uid() = id
    and is_admin = (select is_admin from profiles where id = auth.uid())
    -- The lion is the association's own mark. The picker only offers it to
    -- volunteers, but the picker is just JavaScript, so the rule lives here too.
    /* Badges that assert who somebody is, rather than what they like, are
       refused here as well as being hidden in the picker. A hidden button is
       not a control. */
    and (avatar is null or avatar not in ('lion', 'admin') or is_admin())
  );

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
declare
  steps int := 0;
  cursor_id uuid := new.reply_to;
begin
  /* One level was too shallow for a real conversation: somebody answering an
     answer had to start again at the top and the thread lost its shape. Three
     is deep enough to follow a back and forth and shallow enough that a phone
     screen does not end up as a column of slivers.

     The loop walks up the chain rather than looking one step back, and carries
     its own ceiling so a cycle, however it got there, cannot spin forever. */
  while cursor_id is not null and steps < 10 loop
    select reply_to into cursor_id from wall_posts where id = cursor_id;
    steps := steps + 1;
  end loop;

  if steps >= 3 then
    raise exception 'Replies only go three deep';
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

alter table profiles add column if not exists tag text;

-- Volunteering at the club and volunteering for the Association are two
-- different things and people do one, the other, or both. One label for both
-- flattened that, and the distinction matters most right now.
--
-- The constraint is dropped and rebuilt by name rather than declared inline,
-- because "add column if not exists" does nothing at all on a database that
-- already has the column, so an inline list would never be updated on the one
-- database that counts.
update profiles set tag = 'ktfcsa-volunteer' where tag = 'volunteer';

alter table profiles drop constraint if exists profiles_tag_check;
alter table profiles add constraint profiles_tag_check
  check (tag is null or tag in ('contributor', 'top-contributor', 'ktfcsa-volunteer',
                    'club-volunteer', 'reporter', 'photographer',
                    'commentator', 'historian', 'groundhopper', 'legend'));

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
  if new_tag is not null and new_tag not in ('contributor', 'top-contributor', 'volunteer', 'reporter', 'photographer',
                    'commentator', 'historian', 'groundhopper', 'legend') then
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

-- ===========================================================================
-- Email consent
--
-- Danny wants to email supporters about the app and about forming the
-- Supporters' Association. The ICO treats promoting the aims of a not for
-- profit as direct marketing, so that needs consent rather than an assumption,
-- and consent has to be a positive act: unticked by default, freely given, and
-- as easy to withdraw as it was to give.
--
-- What is recorded is the answer and the moment it was given, because being
-- able to show when somebody agreed is the point of keeping it.
-- ===========================================================================

alter table profiles add column if not exists email_opt_in boolean not null default false;
alter table profiles add column if not exists email_opt_in_at timestamptz;

comment on column profiles.email_opt_in is
  'Consent to be emailed about the app and the Supporters Association. Never ads.';
comment on column profiles.email_opt_in_at is
  'When consent was last given or withdrawn, so it can be evidenced.';

/* Stamp the moment consent changes, rather than trusting the client to. */
create or replace function stamp_email_consent()
returns trigger
language plpgsql
as $$
begin
  if new.email_opt_in is distinct from old.email_opt_in then
    new.email_opt_in_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_email_consent on profiles;
create trigger profiles_email_consent
  before update on profiles
  for each row execute function stamp_email_consent();

/* A count for the admin panel. Not the addresses: those live in auth.users,
   which the app has no business reading. */
create or replace view email_consent_summary as
select
  count(*) filter (where email_opt_in)::int      as opted_in,
  count(*) filter (where not email_opt_in)::int  as opted_out,
  count(*)::int                                   as total
from profiles;

alter view email_consent_summary set (security_invoker = true);
grant select on email_consent_summary to anon, authenticated;

-- ===========================================================================
-- Supporter suggested polls
--
-- Anybody with an account can put a poll forward, but it does not appear until
-- a volunteer says so. The gate is here rather than in the app: hiding the
-- button is not a control.
-- ===========================================================================

alter table polls add column if not exists status text not null default 'live'
  check (status in ('pending', 'live', 'rejected'));

comment on column polls.status is
  'pending until a volunteer approves it. Anything a volunteer creates starts live.';

/* Everything that existed before this column did was made by a volunteer, so
   it stays live. Only new suggestions arrive pending. */
update polls set status = 'live' where status is null;

drop policy if exists "polls readable" on polls;
create policy "polls readable" on polls
  for select using (
    status = 'live'
    or is_admin()
    or auth.uid() = profile_id   -- you can see your own while it waits
  );

drop policy if exists "volunteers creates polls" on polls;
drop policy if exists "suggest a poll" on polls;
create policy "suggest a poll" on polls
  for insert with check (
    auth.uid() = profile_id
    /* A volunteer's poll goes straight up. Anybody else's has to wait, and
       cannot set its own status to live on the way in. */
    and (is_admin() or status = 'pending')
  );

/**
 * Approving or rejecting a suggestion. A function rather than an update policy
 * so a supporter cannot flip their own poll live by patching the row.
 */
create or replace function set_poll_status(target uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can approve a poll';
  end if;
  if new_status not in ('pending', 'live', 'rejected') then
    raise exception 'Unknown status';
  end if;
  update polls set status = new_status where id = target;
end;
$$;

revoke all on function set_poll_status(uuid, text) from public;
grant execute on function set_poll_status(uuid, text) to authenticated;

/* How many are waiting, for the admin panel. */
create or replace view poll_queue_count as
select count(*)::int as pending from polls where status = 'pending';

alter view poll_queue_count set (security_invoker = true);
grant select on poll_queue_count to authenticated;

-- ===========================================================================
-- Poppies Daily
--
-- Five questions a day, the same five for everyone, built ahead of time by
-- scripts/build-quiz.mjs and shipped in data/quiz-bank.json. The questions are
-- not stored here: that file is the record of what was asked, and a row below
-- only says how somebody got on.
-- ===========================================================================

-- The date in Kettering, whatever the supporter's phone thinks. Somebody
-- watching from Spain rolls over when the ground does.
--
-- Stable rather than immutable, because it reads now(). That is exactly why
-- the no-future-dates rule lives in the policy below and not in a check
-- constraint on the table: Postgres will not have a check that moves.
create or replace function london_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/London')::date;
$$;

create table if not exists quiz_results (
  profile_id uuid not null references profiles on delete cascade,
  quiz_date  date not null,
  score      int  not null check (score between 0 and 5),
  -- One character per question in order, 1 right and 0 wrong. This is what the
  -- shareable grid is drawn from, so it has to survive the round trip.
  marks      text not null check (marks ~ '^[01]{5}$'),
  created_at timestamptz not null default now(),
  primary key (profile_id, quiz_date)
);

comment on table quiz_results is
  'One Poppies Daily per supporter per day. Streaks are worked out in the view below, never stored.';

create index if not exists quiz_results_date_idx on quiz_results (quiz_date desc);

alter table quiz_results enable row level security;

-- Readable by anyone, like the prediction league. A score out of five and a
-- date says no more than the leaderboard it feeds.
drop policy if exists "quiz results are public" on quiz_results;
create policy "quiz results are public" on quiz_results
  for select using (true);

drop policy if exists "record your own day" on quiz_results;
create policy "record your own day" on quiz_results
  for insert with check (
    auth.uid() = profile_id
    and quiz_date <= london_today()
    -- Sixty days back is the window the guest carry-over needs and nothing
    -- more. It is deliberately shorter than the question cooldown, so nobody
    -- can invent a long streak after the fact without inventing every day of it.
    and quiz_date >= london_today() - 60
  );

-- Only today's can be changed, and only by the person who set it. Yesterday is
-- finished, which is rather the point of a daily.
drop policy if exists "correct today's answer" on quiz_results;
create policy "correct today's answer" on quiz_results
  for update using (auth.uid() = profile_id and quiz_date = london_today())
  with check (auth.uid() = profile_id and quiz_date = london_today());

drop policy if exists "forget your own days" on quiz_results;
create policy "forget your own days" on quiz_results
  for delete using (auth.uid() = profile_id or is_admin());

-- The daily table. A streak is a run of consecutive days ending today or
-- yesterday: somebody who has not played yet this morning has not lost it.
--
-- The trick is that quiz_date minus a row number stays constant across a run
-- of consecutive dates, so grouping on it finds the runs without a loop.
create or replace view poppies_daily_league as
with runs as (
  select
    profile_id,
    quiz_date,
    score,
    quiz_date - (row_number() over (partition by profile_id order by quiz_date))::int as run
  from quiz_results
),
grouped as (
  select profile_id, run, count(*)::int as len, max(quiz_date) as last_day
  from runs
  group by profile_id, run
),
current_run as (
  select profile_id, max(len) as streak
  from grouped
  where last_day >= london_today() - 1
  group by profile_id
),
best_run as (
  select profile_id, max(len) as best from grouped group by profile_id
),
totals as (
  select
    profile_id,
    count(*)::int                                                   as played,
    sum(score)::int                                                 as points,
    count(*) filter (where score = 5)::int                          as perfect,
    coalesce(sum(score) filter (where quiz_date > london_today() - 30), 0)::int as points_30
  from quiz_results
  group by profile_id
)
select
  pr.id as profile_id,
  pr.display_name,
  t.played,
  t.points,
  t.perfect,
  t.points_30,
  coalesce(c.streak, 0)::int as streak,
  coalesce(b.best, 0)::int   as best_streak
from totals t
join profiles pr        on pr.id = t.profile_id
left join current_run c on c.profile_id = t.profile_id
left join best_run b    on b.profile_id = t.profile_id;

comment on view poppies_daily_league is
  'Poppies Daily table. points_30 is there so somebody who starts in March is not permanently behind.';

alter view poppies_daily_league set (security_invoker = true);
grant select on poppies_daily_league to anon, authenticated;
grant execute on function london_today() to anon, authenticated;

-- ===========================================================================
-- The Poppies Archive
--
-- A supporter-led effort to digitise programmes, tapes, photographs and
-- anything else Kettering Town before it rots in a loft. Nothing is built yet:
-- this table only records who has offered to help and what they can offer, so
-- the idea can be sized before anybody promises anything.
--
-- One row per supporter, editable, because an offer is a standing thing rather
-- than a message.
-- ===========================================================================

create table if not exists archive_offers (
  profile_id    uuid primary key references profiles on delete cascade,
  -- The scanning is the real work, so it is asked about first.
  can_scan      boolean not null default false,
  has_media     boolean not null default false,
  can_catalogue boolean not null default false,
  can_store     boolean not null default false,
  note          text check (note is null or char_length(note) <= 600),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table archive_offers is
  'Who has offered to help with the archive project, and how. One row per supporter.';

alter table archive_offers enable row level security;

-- Deliberately not public. Somebody saying they have a loft full of programmes
-- has told us something about their house, so only they and the volunteers
-- running the project can read it. The counts below are what everyone sees.
drop policy if exists "read your own offer" on archive_offers;
create policy "read your own offer" on archive_offers
  for select using (auth.uid() = profile_id or is_admin());

drop policy if exists "offer to help" on archive_offers;
create policy "offer to help" on archive_offers
  for insert with check (auth.uid() = profile_id);

drop policy if exists "change your own offer" on archive_offers;
create policy "change your own offer" on archive_offers
  for update using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists "withdraw your own offer" on archive_offers;
create policy "withdraw your own offer" on archive_offers
  for delete using (auth.uid() = profile_id or is_admin());

-- Totals only, never who. Enough to show the project is worth starting.
create or replace view archive_offer_counts as
select
  count(*)::int                                  as offers,
  count(*) filter (where can_scan)::int          as scanners,
  count(*) filter (where has_media)::int         as with_media,
  count(*) filter (where can_catalogue)::int     as cataloguers,
  count(*) filter (where can_store)::int         as storers
from archive_offers;

comment on view archive_offer_counts is
  'Headline numbers for the archive project page. No names, by design.';

-- NOTE: security_invoker = false, which is the opposite of every other view in
-- this file, and deliberate. The rows underneath are private, so a view that
-- ran as the caller would return zero to everybody except the person counting
-- themselves. Running as owner is what lets a signed-out supporter see that
-- eleven people have offered to help, while still seeing none of them.
-- It is safe only because this view exposes counts and no identifying column.
-- If a column is ever added here, check that line again first.
alter view archive_offer_counts set (security_invoker = false);
grant select on archive_offer_counts to anon, authenticated;

-- ===========================================================================
-- Admin panel, brought up to date
--
-- The panel was built before Poppies Daily and the archive project existed, so
-- it counted neither. Worse, the offers to help were readable by volunteers in
-- policy and shown nowhere at all, which is the same as not collecting them.
-- ===========================================================================

-- Replaces the definition further up this file, and has to live down here
-- rather than being edited in place: it now counts quiz_results, archive_offers
-- and london_today(), none of which exist yet at that point in the file, so a
-- fresh database would fail on the way past. Postgres only lets a replacement
-- add columns at the end, which is why the original twelve keep their order.
--
-- Same all-or-nothing rule as before: a volunteer sees every number, or nobody
-- sees any, rather than most of them with one quietly missing.
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
  (select count(*) from feedback where handled = false)            as feedback_waiting,
  -- Poppies Daily
  (select count(*) from quiz_results)                              as quiz_plays,
  (select count(distinct profile_id) from quiz_results)            as quiz_players,
  (select count(*) from quiz_results where quiz_date = london_today()) as quiz_today,
  (select coalesce(max(streak), 0) from poppies_daily_league)      as quiz_best_streak,
  -- The archive project
  (select count(*) from archive_offers)                            as archive_offers,
  (select count(*) from archive_offers where can_scan)             as archive_scanners,
  -- Waiting on a volunteer
  (select count(*) from polls where status = 'pending')            as polls_waiting
) counts
where is_admin();

alter view admin_overview set (security_invoker = true);
grant select on admin_overview to authenticated;

-- Who has offered to help with the archive, for the volunteers who have to act
-- on it. Same all-or-nothing gate: not a volunteer, not a single row.
create or replace view archive_offer_list as
select
  o.profile_id,
  p.display_name,
  o.can_scan,
  o.has_media,
  o.can_catalogue,
  o.can_store,
  o.note,
  o.created_at,
  o.updated_at
from archive_offers o
join profiles p on p.id = o.profile_id
where is_admin();

comment on view archive_offer_list is
  'The archive offers with names attached, for volunteers only. The public sees archive_offer_counts instead.';

alter view archive_offer_list set (security_invoker = true);
grant select on archive_offer_list to authenticated;

-- ===========================================================================
-- Fan consultation, 17 to 21 August 2026
--
-- A time-limited survey on how the club is being run: confidence, direction,
-- who supporters feel represented by, what worries them, a question to put to
-- the club, and what action they would support.
--
-- Two rules run through this table.
--
-- The numbers are public and the words are not. Aggregates come from views
-- that run as owner so a signed-out visitor can see the totals; the rows
-- underneath are readable by volunteers alone. Nothing anybody wrote reaches
-- the public or the club until a volunteer has read it and approved it, which
-- is why every free-text field carries its own status.
--
-- And anyone can answer, not just account holders, because a mandate that
-- covers only the ninety-odd people with logins is not a mandate. Signed-in
-- responses are marked so the report can say how many came from members.
-- ===========================================================================

create table if not exists consultation_responses (
  id uuid primary key default gen_random_uuid(),
  -- Null when nobody was signed in. Not required, deliberately.
  profile_id uuid references profiles on delete set null,
  -- A random string from the device, so somebody can amend their answer.
  -- Not an identifier, not derived from anything, and never shown.
  device_key text not null check (char_length(device_key) between 8 and 64),

  -- The structured part. Safe to publish as numbers, and the only required bit.
  confidence     int  not null check (confidence between 1 and 10),
  direction      text not null check (direction in ('right','wrong','unsure')),
  representation jsonb not null default '{}'::jsonb,
  positives      text[] not null default '{}',
  concerns       text[] not null default '{}',
  actions        text[] not null default '{}',

  -- The words. Published only once a volunteer has approved them.
  positive_note text check (positive_note is null or char_length(positive_note) <= 600),
  concern_note  text check (concern_note  is null or char_length(concern_note)  <= 600),
  question      text check (question      is null or char_length(question)      <= 400),
  attribution   text check (attribution   is null or char_length(attribution)   <= 60),
  -- Unticked by default, like email consent. Silence is not permission.
  publish_ok    boolean not null default false,

  -- Would they come to the first meeting of the association, and how. The
  -- point of asking all this is to organise, not only to record a mood.
  meeting text check (meeting in ('in-person','online','either','updates','no')),

  note_status     text not null default 'pending'
    check (note_status in ('pending','approved','rejected')),
  question_status text not null default 'pending'
    check (question_status in ('pending','approved','rejected')),
  -- Filled in when a question has been put to the club, so the results page
  -- can show how long it has gone unanswered.
  asked_at   timestamptz,
  answered_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table consultation_responses is
  'Fan consultation, August 2026. Rows are private to volunteers; the public sees the two views below.';

create unique index if not exists consultation_one_per_device
  on consultation_responses (device_key);
create index if not exists consultation_pending_idx
  on consultation_responses (created_at desc)
  where note_status = 'pending' or question_status = 'pending';

-- The window: Monday 17 August, to midday on Friday 21 August, at the ground.
--
-- A timestamp rather than a date, because the closing time is midday and not
-- midnight, and Europe/London rather than UTC because in August those are an
-- hour apart. The page shows the same deadline, but this is the one that
-- decides: a closing time a browser can argue with is not a closing time.
--
-- Stable, not immutable, for the same reason london_today() is, so the rule
-- lives in the policy rather than a check constraint.
create or replace function consultation_open()
returns boolean
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/London') >= timestamp '2026-08-17 00:00'
     and (now() at time zone 'Europe/London') <  timestamp '2026-08-21 12:00';
$$;

alter table consultation_responses enable row level security;

-- Anyone may answer, signed in or not, but only while it is open and only
-- under their own account if they have one.
drop policy if exists "answer the consultation" on consultation_responses;
create policy "answer the consultation" on consultation_responses
  for insert with check (
    consultation_open()
    and (profile_id is null or profile_id = auth.uid())
  );

-- Amending your own answer, if you were signed in when you gave it.
--
-- There is no anonymous amendment, and there cannot be. The device key lives
-- in the supporter's browser and the database has no way to check a claim to
-- hold it, so a policy that allowed an update on the strength of it would let
-- anybody rewrite everybody's answers. One response per device, unique index
-- above, and the form is replaced by a thank-you once it has been given.
drop policy if exists "amend your own answer" on consultation_responses;
create policy "amend your own answer" on consultation_responses
  for update using (
    is_admin() or (consultation_open() and profile_id is not null and profile_id = auth.uid())
  )
  with check (
    is_admin() or (consultation_open() and profile_id is not null and profile_id = auth.uid())
  );

-- Nobody reads the raw responses but volunteers. Not even the person who
-- wrote one: they have their own copy on their device.
drop policy if exists "volunteers read the responses" on consultation_responses;
create policy "volunteers read the responses" on consultation_responses
  for select using (is_admin());

drop policy if exists "volunteers remove a response" on consultation_responses;
create policy "volunteers remove a response" on consultation_responses
  for delete using (is_admin());

-- The headline numbers. Counts and averages only.
create or replace view consultation_summary as
select
  count(*)::int                                                   as responses,
  count(*) filter (where profile_id is not null)::int             as from_members,
  round(avg(confidence)::numeric, 1)                              as confidence_avg,
  count(*) filter (where direction = 'right')::int                as direction_right,
  count(*) filter (where direction = 'wrong')::int                as direction_wrong,
  count(*) filter (where direction = 'unsure')::int               as direction_unsure,
  count(*) filter (where question is not null and question <> '')::int as questions_asked,
  count(*) filter (where meeting in ('in-person','either'))::int  as meeting_in_person,
  count(*) filter (where meeting in ('online','either'))::int     as meeting_online,
  count(*) filter (where meeting = 'updates')::int                as meeting_updates,
  count(*) filter (where meeting is not null and meeting <> 'no')::int as meeting_any,
  min(created_at)                                                 as opened,
  max(created_at)                                                 as latest
from consultation_responses;

-- The distribution behind the average, so the headline can be checked rather
-- than taken on trust. The May report published this and was stronger for it.
create or replace view consultation_confidence as
select confidence as score, count(*)::int as people
from consultation_responses group by confidence;

-- How often each option was picked, across the three multi-select questions.
create or replace view consultation_choices as
select 'positive' as kind, unnest(positives) as choice, count(*)::int as people
from consultation_responses group by 1, 2
union all
select 'concern', unnest(concerns), count(*)::int
from consultation_responses group by 1, 2
union all
select 'action', unnest(actions), count(*)::int
from consultation_responses group by 1, 2;

-- Who supporters feel represented by. One row per body per verdict.
create or replace view consultation_representation as
select
  key                          as body,
  value #>> '{}'               as verdict,
  count(*)::int                as people
from consultation_responses, jsonb_each(representation)
group by 1, 2;

-- Only what a volunteer has approved, and a name only where it was offered.
create or replace view consultation_published as
select
  id,
  case when note_status = 'approved' then positive_note end as positive_note,
  case when note_status = 'approved' then concern_note  end as concern_note,
  case when question_status = 'approved' then question  end as question,
  case when publish_ok then attribution end                 as attribution,
  asked_at,
  answered_at,
  created_at
from consultation_responses
where note_status = 'approved' or question_status = 'approved';

comment on view consultation_published is
  'Approved comments and questions only. A name appears only where the supporter ticked the box.';

-- NOTE: these five run as owner, not invoker, and that is deliberate for the
-- same reason archive_offer_counts does. The rows underneath are volunteers-
-- only, so an invoker view would return nothing to the public and the whole
-- point is that the public can see the findings. It is safe because none of
-- them exposes an identifying column: no profile_id, no device_key, and a name
-- only where somebody asked for their name to be used. Check that again before
-- adding a column to any of them.
alter view consultation_summary        set (security_invoker = false);
alter view consultation_confidence     set (security_invoker = false);
alter view consultation_choices        set (security_invoker = false);
alter view consultation_representation set (security_invoker = false);
alter view consultation_published      set (security_invoker = false);

grant select on consultation_summary, consultation_confidence, consultation_choices,
                consultation_representation, consultation_published
  to anon, authenticated;
grant execute on function consultation_open() to anon, authenticated;

-- Everything waiting on a volunteer, for the badge in the navigation.
create or replace view pending_actions as
select * from (
select
  (select count(*) from consultation_responses
    where (note_status = 'pending' and (positive_note is not null or concern_note is not null))
       or (question_status = 'pending' and question is not null))::int as consultation,
  (select count(*) from polls where status = 'pending')::int           as polls,
  (select count(*) from feedback where handled = false)::int           as feedback
) c
where is_admin();

alter view pending_actions set (security_invoker = true);
grant select on pending_actions to authenticated;

-- ===========================================================================
-- Early sight of the consultation results
--
-- The findings go public on the Saturday. Before that a named few need to see
-- them to prepare, without being able to moderate, approve, or read anybody's
-- raw response. This is a view-only pass and nothing more.
-- ===========================================================================

alter table profiles add column if not exists results_viewer boolean not null default false;

comment on column profiles.results_viewer is
  'Early, read-only sight of the consultation results. Not a moderator: grants no access to raw responses.';

-- Set by a volunteer, through a function rather than an update policy for the
-- same reason set_user_tag is: it lets an admin hand out this one pass without
-- also handing out the ability to make somebody an admin.
create or replace function set_results_viewer(target uuid, allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can do that.';
  end if;
  update profiles set results_viewer = allowed where id = target;
end;
$$;

revoke all on function set_results_viewer(uuid, boolean) from public;
grant execute on function set_results_viewer(uuid, boolean) to authenticated;

-- The pass itself grants nothing extra in the database: the results come from
-- the aggregate views, which are already public. What it buys is sight of them
-- before the Saturday, which is a decision the app makes. Said out loud here so
-- nobody hunts for a policy that does not exist.
