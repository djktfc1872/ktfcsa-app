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

-- ===========================================================================
-- Whether away fans are actually welcome
-- ===========================================================================
--
-- The one thing a travelling supporter wants to know about a pub near an away
-- ground, and the one thing the existing free-text note was the wrong shape
-- for. Some places are glad to see you, some would rather you walked on, and
-- finding out at the door is how away days go wrong.
--
-- Three values rather than a rating: this is not a review of the beer.

alter table pubs add column if not exists away_friendly text
  check (away_friendly is null or away_friendly in ('yes', 'mixed', 'no'));

comment on column pubs.away_friendly is
  'Whether away supporters are made welcome. Set by whoever suggested it, corrected by anybody who goes.';

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
--
-- Dropped and recreated rather than replaced. It selects p.*, so every column
-- added to pubs lands in the middle of this view's shape, and "create or
-- replace view" refuses to change the name of a column in a given position:
-- adding away_friendly failed with 42P16 saying it could not rename "votes".
drop view if exists pub_list cascade;
create view pub_list as
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

alter table profiles add column if not exists is_moderator boolean not null default false;

comment on column profiles.is_moderator is
  'Can moderate what supporters write, and see the panel. Cannot change structure.';

-- True for moderators and for admins, since an admin can do anything a
-- moderator can. Used only on the moderation surfaces below.
create or replace function is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or is_moderator from profiles where id = auth.uid()),
    false);
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

-- A supporter may edit their own post. Nobody else may touch it.
--
-- This policy used to end with `or auth.role() = 'authenticated'`, which was
-- there so that anybody could nudge the likes and reports counters. With no
-- `with check` alongside it, that clause let any signed-in supporter update any
-- column of any post: rewrite somebody else's words, or un-hide a post a
-- moderator had hidden. Liking now goes through wall_likes and like_post()
-- below, and reporting through report_post(), so the blanket clause is gone.
drop policy if exists "update wall post" on wall_posts;
create policy "update wall post" on wall_posts
  for update
  using       (auth.uid() = profile_id or is_admin() or is_moderator())
  with check  (auth.uid() = profile_id or is_admin() or is_moderator());

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
  /* Checked against the table's own constraint rather than a list kept here.
     There were two lists, they drifted the moment the volunteer tag was split
     in two, and the function went on rejecting the new values with "Unknown
     tag" while the table would happily have taken them. One source of truth:
     if the column accepts it, so does this. */
  begin
    update profiles set tag = new_tag where id = target;
  exception when check_violation then
    raise exception 'Unknown tag: %', new_tag;
  end;
  return;
end;
$$;

revoke all on function set_user_tag(uuid, text) from public;
grant execute on function set_user_tag(uuid, text) to authenticated;

-- What the people running the site can see at a glance. Counts only, no
-- reading of anybody's messages.
-- Dropped first, not replaced. "create or replace view" cannot remove or
-- reorder columns, and this file defines admin_overview twice: a small version
-- here, and a fuller one at the end once the tables it counts exist. On a
-- database that already has the fuller one, replacing it with this shorter one
-- would be dropping seven columns, which Postgres refuses with 42P16. Dropping
-- makes re-running the file safe, which is the whole point of this file.
drop view if exists admin_overview;
create view admin_overview as
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
drop view if exists archive_offer_counts cascade;
create view archive_offer_counts as
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
drop view if exists admin_overview;
create view admin_overview as
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
-- Dropped and recreated rather than replaced. "create or replace view" can only
-- ever ADD columns at the end: it cannot insert one in the middle or reorder,
-- and trying reports "cannot drop columns from view", which is a confusing way
-- of saying the column in that position is not the one it expected. The
-- meeting counts were added in the middle of this list and took the whole file
-- down with them. Dropping first means the shape can change freely; nothing
-- reads this view except the app, so there is nothing to cascade to.
drop view if exists consultation_summary;
create view consultation_summary as
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
drop view if exists consultation_confidence cascade;
create view consultation_confidence as
select confidence as score, count(*)::int as people
from consultation_responses group by confidence;

-- How often each option was picked, across the three multi-select questions.
drop view if exists consultation_choices cascade;
create view consultation_choices as
select 'positive' as kind, unnest(positives) as choice, count(*)::int as people
from consultation_responses group by 1, 2
union all
select 'concern', unnest(concerns), count(*)::int
from consultation_responses group by 1, 2
union all
select 'action', unnest(actions), count(*)::int
from consultation_responses group by 1, 2;

-- Who supporters feel represented by. One row per body per verdict.
drop view if exists consultation_representation cascade;
create view consultation_representation as
select
  key                          as body,
  value #>> '{}'               as verdict,
  count(*)::int                as people
from consultation_responses, jsonb_each(representation)
group by 1, 2;

-- Only what a volunteer has approved, and a name only where it was offered.
drop view if exists consultation_published cascade;
create view consultation_published as
select
  id,
  -- Published beside the quote so it cannot be lifted away from the view of the
  -- person who wrote it. Already public in aggregate, and on its own a score
  -- from one to ten identifies nobody.
  confidence,
  case when note_status = 'approved' then positive_note end as positive_note,
  case when note_status = 'approved' then concern_note  end as concern_note,
  case when question_status = 'approved' then question  end as question,
  case when publish_ok then attribution end                 as attribution,
  asked_at,
  answered_at,
  created_at
from consultation_responses
where (note_status = 'approved' or question_status = 'approved')
  -- Approved means "a volunteer cleared this for publication", not "publish it
  -- now". Without this the quotes were readable through the API while the page
  -- still said the results were not out, which makes the embargo a matter of
  -- the front end being polite rather than anything actually holding.
  and (
    (select results_public from consultation_settings where id)
    or is_admin()
    or exists (
      select 1 from profiles p
      -- The moderator role carries early sight as well, so the one-off flag is
      -- for people who need to read the findings and nothing else. Without
      -- this, making somebody a moderator and clearing their flag would quietly
      -- take away something they had.
      where p.id = auth.uid() and (p.results_viewer or p.is_moderator)
    )
  );

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
drop view if exists pending_actions cascade;
create view pending_actions as
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

-- ===========================================================================
-- Publishing the consultation, and the questions grouped
--
-- Closing and publishing are two different things. The consultation shuts at
-- midday on the Friday; the findings go out that evening, when a volunteer
-- presses the button. Left on a timer it would publish at midday with whatever
-- had been read by lunchtime.
-- ===========================================================================

create table if not exists consultation_settings (
  id             boolean primary key default true check (id),  -- exactly one row
  results_public boolean not null default false,
  published_at   timestamptz,
  updated_at     timestamptz not null default now()
);

insert into consultation_settings (id) values (true) on conflict (id) do nothing;

comment on table consultation_settings is
  'One row. results_public is the switch that puts the findings on the public page.';

alter table consultation_settings enable row level security;

drop policy if exists "anyone can see whether it is published" on consultation_settings;
create policy "anyone can see whether it is published" on consultation_settings
  for select using (true);

-- Through a function rather than an update policy, so the stamp cannot be
-- forgotten and the same rule applies everywhere. Matches set_user_tag.
create or replace function publish_results(on_now boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can publish the results.';
  end if;
  update consultation_settings
     set results_public = on_now,
         published_at   = case when on_now then coalesce(published_at, now()) else null end,
         updated_at     = now()
   where id;
end;
$$;

revoke all on function publish_results(boolean) from public;
grant execute on function publish_results(boolean) to authenticated;

-- ------------------------------------------------------- grouped questions
--
-- Ninety-five questions from a hundred and seventy-eight supporters, and a
-- great many of them are the same question written differently. A club sent
-- ninety-five questions answers none of them.
--
-- The grouping is suggested by clustering in the browser and then done by a
-- person: the label below is the wording a volunteer agreed, never a
-- supporter's words picked automatically.

create table if not exists consultation_question_groups (
  id         uuid primary key default gen_random_uuid(),
  -- 400 was the limit on a supporter's own question, borrowed here by mistake.
  -- These are the Association's questions, put formally to the club, and they
  -- carry several clauses each: dates, counts, and what to answer if not.
  label      text not null check (char_length(label) between 5 and 1200),
  topic      text,
  members    uuid[] not null default '{}',
  sort       int not null default 0,
  status     text not null default 'draft' check (status in ('draft','final')),
  asked_at   timestamptz,     -- stamped when the list goes to the club
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- Where a question came from
-- ===========================================================================
--
-- Every question on the public page was a merged group of things supporters
-- actually wrote, and the page says so. Two questions sent to the club on
-- 24 August were not: they were agreed by the working group after another
-- inappropriate post from the club's account, and Danny said so plainly in the
-- letter.
--
-- Those two have no members, so `asked_by` is zero, and the page would have
-- rendered "Asked by 0 supporters" and "nobody ticked the box saying we could
-- publish their wording". Both untrue, on a page being used in a dispute with
-- the club, which is the worst possible place to be loose about attribution.
--
-- It is declared rather than inferred from an empty member list. Inference
-- would have worked today and quietly broken the first time somebody created a
-- group and filled it in afterwards.

-- ===========================================================================
-- Replied, and answered, are not the same thing
-- ===========================================================================
--
-- Danny's standard, stated on 24 August: answered means the club wrote back
-- with a satisfactory answer. Not that they replied, and not that the thing
-- quietly got fixed.
--
-- With only `answered_at` there was nowhere to put the likeliest outcome of
-- all: a reply that arrives and does not answer the question. Marking that
-- answered would be untrue, and leaving it running says the club ignored it,
-- which is also untrue. Both misrepresent them, and this page cannot afford to
-- misrepresent anybody.
--
-- So: `replied_at` is when they wrote back at all, `answered_at` is when they
-- actually answered it, and `reply_note` is room to say in a line what they
-- said. A question can carry a replied_at and no answered_at for as long as
-- that is the honest description of where it stands.

alter table consultation_question_groups add column if not exists replied_at timestamptz;
alter table consultation_question_groups add column if not exists reply_note text
  check (reply_note is null or char_length(reply_note) <= 400);

comment on column consultation_question_groups.replied_at is
  'When the club wrote back about this at all. Not the same as answering it.';
comment on column consultation_question_groups.answered_at is
  'When the club answered it satisfactorily. The bar is a written, satisfactory
   answer: not a reply that says nothing, and not the thing being quietly fixed.';
comment on column consultation_question_groups.reply_note is
  'One line, published, on what they said. Shown under the question.';

alter table consultation_question_groups add column if not exists origin text
  not null default 'supporters'
  check (origin in ('supporters', 'working_group'));

comment on column consultation_question_groups.origin is
  'supporters = merged from consultation responses. working_group = agreed by
   the working group and sent alongside them, with no survey answers behind it.';

comment on table consultation_question_groups is
  'Questions merged for the club. label is the volunteer-agreed wording; members are the responses it covers.';

-- The table may already exist with the older, too-short limit.
alter table consultation_question_groups
  drop constraint if exists consultation_question_groups_label_check;
alter table consultation_question_groups
  add constraint consultation_question_groups_label_check
  check (char_length(label) between 5 and 1200);

alter table consultation_question_groups enable row level security;

-- Volunteers only. The public reads the view below, which is narrower.
drop policy if exists "volunteers read question groups" on consultation_question_groups;
create policy "volunteers read question groups" on consultation_question_groups
  for select using (is_admin());

drop policy if exists "volunteers write question groups" on consultation_question_groups;
create policy "volunteers write question groups" on consultation_question_groups
  for all using (is_admin()) with check (is_admin());

-- What the public gets: final groups, only once published, with how many asked
-- and up to three of the original phrasings.
--
-- Those samples come only from questions that were individually approved, so
-- the grouping cannot carry anything into public view that would not have got
-- there on its own. Worth keeping in mind if this view is ever widened.
drop view if exists consultation_questions_public cascade;
create view consultation_questions_public as
select
  g.id,
  g.label,
  g.topic,
  g.sort,
  cardinality(g.members)                      as asked_by,
  g.origin,
  coalesce(sample.wording, '{}')              as samples,
  coalesce(sample.n, 0)                       as samples_total,
  g.asked_at,
  g.replied_at,
  g.reply_note,
  g.answered_at
from consultation_question_groups g
-- Every approved wording behind the question, not a token three: the promise on
-- the public page is that you can see what is under each one. Anything a
-- supporter did not clear for publication is still counted in asked_by and
-- still went to the club, it simply cannot be shown, and the page says so.
left join lateral (
  select array_agg(r.question) as wording, count(*) as n
  from (
    select r.question
    from consultation_responses r
    where r.id = any(g.members)
      and r.question_status = 'approved'
      and r.question is not null
    limit 40
  ) r
) sample on true
where g.status = 'final'
  -- Published to everyone once the switch is on. Before that, still visible to
  -- volunteers and to anyone given early sight, because a preview that cannot
  -- show the merged questions is a preview of the wrong page: it would fall
  -- back to the individually approved list and look nothing like what goes out.
  and (
    (select results_public from consultation_settings where id)
    or is_admin()
    or exists (
      select 1 from profiles p
      -- The moderator role carries early sight as well, so the one-off flag is
      -- for people who need to read the findings and nothing else. Without
      -- this, making somebody a moderator and clearing their flag would quietly
      -- take away something they had.
      where p.id = auth.uid() and (p.results_viewer or p.is_moderator)
    )
  );

-- NOTE: owner, not invoker, for the same reason as consultation_summary. The
-- rows underneath are volunteers-only and the whole point is that the public
-- can read the findings. Safe because every column here is either the
-- volunteer's own wording, a count, or a phrasing already approved for
-- publication. Check that again before adding a column.
alter view consultation_questions_public set (security_invoker = false);
grant select on consultation_questions_public to anon, authenticated;

-- ===========================================================================
-- How many people are looking, and at what
-- ===========================================================================
--
-- Counters, and nothing else. No IP address, no user agent, no device id, no
-- account, no cookie, nothing that could be joined back to a person or to a
-- consultation response. A row says "on this day, this route was opened this
-- many times, by this many browsers that had not opened anything yet today".
--
-- "Unique" is decided in the browser, not here: it keeps a date in local
-- storage and tells us whether this is its first look today. That means the
-- identifier never leaves the device and there is nothing on the server to
-- de-anonymise later, even by us. The trade is that clearing storage or using
-- a second browser counts twice, so uniques are a floor rather than a truth.

create table if not exists page_views (
  day     date not null default london_today(),
  route   text not null,
  views   int  not null default 0,
  uniques int  not null default 0,
  primary key (day, route)
);

comment on table page_views is
  'Daily counters per route. Contains no identifiers of any kind, by design.';

alter table page_views enable row level security;

-- Nobody reads this but volunteers. There is nothing sensitive in it, but a
-- public view count is a thing people argue about, so it stays internal.
drop policy if exists "volunteers read views" on page_views;
create policy "volunteers read views" on page_views
  for select using (is_admin());

-- No insert or update policy: everything goes through the function below, so a
-- caller can add one to a counter and cannot do anything else at all.

create or replace function record_view(p_route text, p_unique boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := left(coalesce(nullif(trim(p_route), ''), 'other'), 40);
begin
  insert into page_views (day, route, views, uniques)
  values (london_today(), r, 1, case when p_unique then 1 else 0 end)
  on conflict (day, route) do update
    set views   = page_views.views + 1,
        uniques = page_views.uniques + (case when p_unique then 1 else 0 end);
end;
$$;

revoke all on function record_view(text, boolean) from public;
grant execute on function record_view(text, boolean) to anon, authenticated;

-- ===========================================================================
-- Moderators
-- ===========================================================================
--
-- A second, smaller role. A moderator can see the panel and deal with what
-- supporters write: approving or rejecting consultation comments, hiding a
-- wall post, reading feedback. A moderator cannot change the shape of
-- anything: not publishing the findings, not agreeing the questions that go to
-- the club, not handing out roles or tags, not touching polls or lineups.
--
-- is_admin() is deliberately untouched. Fifty four policies depend on it and
-- it still means exactly what it did: full rights. Everything below is
-- additive, so an existing admin loses nothing and gains nothing.

-- The column and the function that go with it now live beside is_admin(), near
-- the top of this file. They were here, below the first policy that calls
-- is_moderator(), which worked only because an existing database already had
-- them from a previous run. On a fresh one the file would have failed.

-- ---- what a moderator may do ---------------------------------------------

-- The consultation queue: read it, and set what is approved or rejected.
drop policy if exists "volunteers read the responses" on consultation_responses;
create policy "volunteers read the responses" on consultation_responses
  for select using (is_moderator());

drop policy if exists "amend your own answer" on consultation_responses;
create policy "amend your own answer" on consultation_responses
  for update using (
    is_moderator() or (consultation_open() and profile_id is not null and profile_id = auth.uid())
  )
  with check (
    is_moderator() or (consultation_open() and profile_id is not null and profile_id = auth.uid())
  );

-- Deleting a response outright stays with admins. Rejecting one hides it just
-- as well and can be undone; deletion cannot, and a moderator has no reason to
-- need it.

-- The fan wall: hide a post, or remove one.
drop policy if exists "wall readable" on wall_posts;
create policy "wall readable" on wall_posts
  for select using (hidden = false or is_moderator());

drop policy if exists "update wall post" on wall_posts;
create policy "update wall post" on wall_posts
  for update using (auth.uid() = profile_id or is_moderator() or auth.role() = 'authenticated');

drop policy if exists "remove wall post" on wall_posts;
create policy "remove wall post" on wall_posts
  for delete using (auth.uid() = profile_id or is_moderator());

-- Feedback: read it, mark it dealt with. Deleting it stays with admins.
drop policy if exists "volunteers reads feedback" on feedback;
create policy "volunteers reads feedback" on feedback for select using (is_moderator());

drop policy if exists "volunteers updates feedback" on feedback;
create policy "volunteers updates feedback" on feedback for update using (is_moderator());

-- ---- handing the role out -------------------------------------------------

-- Admins only, and an admin cannot be demoted to moderator by accident here:
-- this sets one flag and leaves is_admin alone.
create or replace function set_moderator(target uuid, allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can do that.';
  end if;
  update profiles set is_moderator = allowed where id = target;
end;
$$;

revoke all on function set_moderator(uuid, boolean) from public;
grant execute on function set_moderator(uuid, boolean) to authenticated;

-- ===========================================================================
-- Tags a volunteer can create
-- ===========================================================================
--
-- The list of supporter tags was in three places: a CHECK constraint here, a
-- label map in the app, and for a while a third copy inside set_user_tag that
-- drifted the moment the volunteer tag was split in two. Now it is a table,
-- and the other two read from it.
--
-- The constraint becomes a foreign key, so a tag cannot be set to something
-- that does not exist and a tag in use cannot quietly vanish from under the
-- people wearing it.

create table if not exists supporter_tags (
  key        text primary key
             check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) between 2 and 40),
  label      text not null check (char_length(label) between 2 and 40),
  sort       int  not null default 100,
  created_at timestamptz not null default now()
);

comment on table supporter_tags is
  'The supporter tags a volunteer may hand out. Editable from the admin panel.';

-- Seed with the ten that were hard coded, keeping the order they were shown
-- in. Existing profiles already carry these keys, so the foreign key below
-- has something to point at.
insert into supporter_tags (key, label, sort) values
  ('contributor',      'Contributor',      10),
  ('top-contributor',  'Top Contributor',  20),
  ('ktfcsa-volunteer', 'KTFCSA Volunteer', 30),
  ('club-volunteer',   'Club Volunteer',   40),
  ('reporter',         'Reporter',         50),
  ('photographer',     'Photographer',     60),
  ('commentator',      'Commentator',      70),
  ('historian',        'Historian',        80),
  ('groundhopper',     'Groundhopper',     90),
  ('legend',           'Legend',          100)
on conflict (key) do nothing;

-- Anything a profile carries that predates the table would break the foreign
-- key, so it is cleared first. In practice there is nothing, but a migration
-- that fails halfway on the one database that counts is not worth the risk.
update profiles set tag = null
 where tag is not null and tag not in (select key from supporter_tags);

alter table profiles drop constraint if exists profiles_tag_check;
alter table profiles drop constraint if exists profiles_tag_fkey;
alter table profiles add constraint profiles_tag_fkey
  foreign key (tag) references supporter_tags (key) on update cascade on delete restrict;

alter table supporter_tags enable row level security;

-- Everyone reads them: a tag shows on a supporter's name all over the site.
drop policy if exists "tags readable" on supporter_tags;
create policy "tags readable" on supporter_tags for select using (true);

-- No insert, update or delete policy. Everything goes through the functions
-- below, so a moderator cannot invent a role-sounding tag for themselves.

create or replace function upsert_tag(p_key text, p_label text, p_sort int default 100)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only a volunteer can do that.';
  end if;
  insert into supporter_tags (key, label, sort)
  values (lower(trim(p_key)), trim(p_label), coalesce(p_sort, 100))
  on conflict (key) do update set label = excluded.label, sort = excluded.sort;
end;
$$;

/* Refuses rather than cascades. Deleting a tag somebody is wearing should be a
   decision, not a side effect, so this says how many hold it and stops. */
create or replace function delete_tag(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  held int;
begin
  if not is_admin() then
    raise exception 'Only a volunteer can do that.';
  end if;
  select count(*) into held from profiles where tag = p_key;
  if held > 0 then
    raise exception 'Still worn by % supporter%. Clear it from them first.',
      held, case when held = 1 then '' else 's' end;
  end if;
  delete from supporter_tags where key = p_key;
end;
$$;

revoke all on function upsert_tag(text, text, int) from public;
revoke all on function delete_tag(text) from public;
grant execute on function upsert_tag(text, text, int) to authenticated;
grant execute on function delete_tag(text) to authenticated;

-- ===========================================================================
-- Who Played More: best streaks
-- ===========================================================================
--
-- One row per supporter, holding their best run and how many they have played.
-- Poppies Daily keeps every result because streaks are worked out from the
-- dates; this game has no dates worth keeping, so it keeps the number and
-- nothing else. Nobody needs a record of every wrong guess anybody has made.

create table if not exists duel_scores (
  profile_id uuid primary key references profiles on delete cascade,
  best       int not null default 0 check (best between 0 and 500),
  plays      int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table duel_scores is
  'Best Who Played More streak per supporter. One row each, overwritten upwards.';

alter table duel_scores enable row level security;

-- Readable by everyone: it is a leaderboard.
drop policy if exists "duel scores readable" on duel_scores;
create policy "duel scores readable" on duel_scores for select using (true);

-- No insert or update policy. The function below is the only way in, so a
-- supporter cannot simply post a streak of four hundred to the table.
create or replace function record_duel(p_streak int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s int := greatest(0, least(coalesce(p_streak, 0), 500));
begin
  if auth.uid() is null then
    return;   /* playing signed out is fine, it just does not count */
  end if;
  insert into duel_scores (profile_id, best, plays, updated_at)
  values (auth.uid(), s, 1, now())
  on conflict (profile_id) do update
    set best = greatest(duel_scores.best, excluded.best),
        plays = duel_scores.plays + 1,
        updated_at = now();
end;
$$;

revoke all on function record_duel(int) from public;
grant execute on function record_duel(int) to authenticated;

-- The board. Names come from profiles, which is why this runs as owner: the
-- rows themselves are public but profiles is not readable row by row.
drop view if exists duel_league cascade;
create view duel_league as
select
  d.profile_id,
  p.display_name,
  d.best,
  d.plays
from duel_scores d
join profiles p on p.id = d.profile_id
where d.best > 0
order by d.best desc, d.plays asc
limit 50;

alter view duel_league set (security_invoker = false);
grant select on duel_league to anon, authenticated;

-- ===========================================================================
-- "Somebody replied to you"
-- ===========================================================================
--
-- The fan wall had no way of telling anybody they had been answered. You
-- posted, and unless you happened to scroll back to the same thread you never
-- found out. A conversation nobody knows is happening is not a conversation.
--
-- One timestamp per supporter rather than a row per notification: the question
-- is only ever "anything since I last looked", and storing a read flag for
-- every reply to every post would be a table that grows forever to answer it.

alter table profiles add column if not exists wall_seen_at timestamptz;

comment on column profiles.wall_seen_at is
  'When this supporter last opened the fan wall. Replies after it are unread.';

create or replace function mark_wall_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update profiles set wall_seen_at = now() where id = auth.uid();
end;
$$;

revoke all on function mark_wall_seen() from public;
grant execute on function mark_wall_seen() to authenticated;

-- Replies to things you wrote, by somebody else, that you have not seen.
-- auth.uid() does the filtering, so this returns one supporter's own business
-- and nobody can ask it about anybody else.
drop view if exists wall_replies_to_me cascade;
create view wall_replies_to_me as
select
  r.id,
  r.reply_to,
  r.author_name,
  r.text,
  r.created_at,
  parent.thread            as thread,
  parent.text              as parent_text
from wall_posts r
join wall_posts parent on parent.id = r.reply_to
where parent.profile_id = auth.uid()
  and r.profile_id is distinct from auth.uid()   -- your own replies are not news
  and r.hidden = false
  and (
    (select wall_seen_at from profiles where id = auth.uid()) is null
    or r.created_at > (select wall_seen_at from profiles where id = auth.uid())
  )
order by r.created_at desc
limit 50;

grant select on wall_replies_to_me to authenticated;

-- ===========================================================================
-- Where people actually parked
-- ===========================================================================
--
-- Fourteen of the twenty two clubs publish nothing about parking, and the map
-- can only say what is there rather than what it costs or whether it fills up
-- by half two. The people who know are the ones who have just done it, and the
-- app already knows who they are because they marked themselves as having
-- gone. So it asks them, once, afterwards.
--
-- Same shape and same rules as price_reports next door: readable by everyone,
-- written only by the person it belongs to, editable and removable by them or
-- a volunteer.

create table if not exists parking_reports (
  id          uuid primary key default gen_random_uuid(),
  club_slug   text not null,
  profile_id  uuid references profiles on delete set null,
  author_name text not null,
  spot        text not null check (spot in ('ground', 'street', 'town', 'pub', 'other')),
  cost        numeric(5,2) check (cost is null or cost between 0 and 40),
  walk_min    int check (walk_min is null or walk_min between 0 and 60),
  notes       text check (notes is null or char_length(notes) <= 300),
  visited_on  date,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists parking_club_idx on parking_reports (club_slug, created_at desc);

comment on table parking_reports is
  'Where supporters actually parked, and what it cost. Asked after a game they marked attending.';

alter table parking_reports enable row level security;

drop policy if exists "parking readable" on parking_reports;
create policy "parking readable" on parking_reports
  for select using (hidden = false or is_moderator());

drop policy if exists "report parking" on parking_reports;
create policy "report parking" on parking_reports
  for insert with check (auth.uid() = profile_id);

drop policy if exists "edit own parking report" on parking_reports;
create policy "edit own parking report" on parking_reports
  for update using (auth.uid() = profile_id or is_moderator());

drop policy if exists "remove own parking report" on parking_reports;
create policy "remove own parking report" on parking_reports
  for delete using (auth.uid() = profile_id or is_moderator());

-- What the app shows: the going rate rather than a list of individual trips.
drop view if exists parking_summary cascade;
create view parking_summary as
select
  club_slug,
  count(*)::int                                     as reports,
  mode() within group (order by spot)               as usual_spot,
  round(avg(cost) filter (where cost is not null), 2) as avg_cost,
  count(*) filter (where cost = 0)::int             as free_reports,
  round(avg(walk_min) filter (where walk_min is not null))::int as avg_walk,
  max(created_at)                                   as latest
from parking_reports
where hidden = false
group by club_slug;

grant select on parking_summary to anon, authenticated;



-- ===========================================================================
-- Grounds visited
-- ===========================================================================
--
-- Attendance already records which of this season's fixtures somebody went to,
-- which gives a grounds list for one season. Supporters have been going for
-- decades, and a groundhopper list that starts in August 2026 is not their
-- list. So a ground can be ticked directly as well, and the two are merged.
--
-- One row per supporter per ground rather than per visit: the question is
-- "have you been", and a first date is enough colour for the ones who care.

create table if not exists ground_visits (
  profile_id uuid not null references profiles on delete cascade,
  club_slug  text not null,
  first_seen date,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (profile_id, club_slug)
);

comment on table ground_visits is
  'Grounds a supporter has ticked off. Merged with attendance, which covers the current season.';

alter table ground_visits enable row level security;

-- Your own list, and nobody else's. There is no leaderboard here on purpose:
-- who has been where is a collection, not a competition, and publishing it
-- would tell anybody who cared which grounds a named person travels to.
drop policy if exists "read your own visits" on ground_visits;
create policy "read your own visits" on ground_visits
  for select using (auth.uid() = profile_id);

drop policy if exists "tick off a ground" on ground_visits;
create policy "tick off a ground" on ground_visits
  for insert with check (auth.uid() = profile_id);

drop policy if exists "amend your own visit" on ground_visits;
create policy "amend your own visit" on ground_visits
  for update using (auth.uid() = profile_id);

drop policy if exists "untick a ground" on ground_visits;
create policy "untick a ground" on ground_visits
  for delete using (auth.uid() = profile_id);

-- How many grounds have been ticked across everybody, with no names attached.
-- Enough to say "eleven supporters have been to Leiston" without saying who.
drop view if exists ground_visit_counts cascade;
create view ground_visit_counts as
select club_slug, count(*)::int as supporters
from ground_visits
group by club_slug;

alter view ground_visit_counts set (security_invoker = false);
grant select on ground_visit_counts to anon, authenticated;

-- ===========================================================================
-- Likes that belong to somebody
-- ===========================================================================
--
-- wall_posts.likes was a bare integer that the browser read, added one to, and
-- wrote back. Two supporters liking the same post in the same minute produced
-- one like, and nothing stopped the same person liking the same post all
-- afternoon. It also needed a policy letting any signed-in supporter update the
-- row, which let them update every other column too. That policy is gone.
--
-- A like is now a row. The counter on wall_posts stays, kept in step by the
-- function below, so nothing that already reads it has to change.

-- Existing likes cannot be attributed to anybody, because until now nothing
-- recorded who gave them. Rebuilding the counter from wall_likes would
-- therefore reset every post on the wall to zero, and supporters would watch
-- their posts lose likes overnight for no reason they could see.
--
-- So the old total is kept as a floor and new likes count on top of it. The
-- seed runs once: after it, legacy_likes is non-zero and the guard skips it, so
-- running this file again does not double anything.
alter table wall_posts add column if not exists legacy_likes int not null default 0;

comment on column wall_posts.legacy_likes is
  'Likes from before wall_likes existed. Nobody owns them, so they are a floor
   under the real count rather than rows. Never written again after the seed.';

update wall_posts set legacy_likes = likes where legacy_likes = 0 and likes > 0;

create table if not exists wall_likes (
  post_id    uuid not null references wall_posts on delete cascade,
  profile_id uuid not null references profiles   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index if not exists wall_likes_profile_idx on wall_likes (profile_id);

alter table wall_likes enable row level security;

-- Readable so the heart can be drawn filled in for what you have already liked.
drop policy if exists "likes readable" on wall_likes;
create policy "likes readable" on wall_likes for select using (true);

-- No insert or update policy. like_post() is the only way in.

create or replace function like_post(p_post uuid, p_on boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to like a post';
  end if;

  if coalesce(p_on, true) then
    insert into wall_likes (post_id, profile_id) values (p_post, auth.uid())
      on conflict do nothing;
  else
    delete from wall_likes where post_id = p_post and profile_id = auth.uid();
  end if;

  select count(*) + coalesce((select legacy_likes from wall_posts where id = p_post), 0)
    into n
    from wall_likes where post_id = p_post;
  update wall_posts set likes = n where id = p_post;
  return n;
end;
$$;

revoke all on function like_post(uuid, boolean) from public;
grant execute on function like_post(uuid, boolean) to authenticated;

-- Reporting lost its blanket update policy along with liking, so it needs the
-- same treatment: anyone signed in may flag a post, and only that.
create or replace function report_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update wall_posts set reports = reports + 1 where id = p_post;
end;
$$;

revoke all on function report_post(uuid) from public;
grant execute on function report_post(uuid) to authenticated;

-- ===========================================================================
-- Topics: somewhere to start a conversation
-- ===========================================================================
--
-- Until now a supporter could reply to things but never begin one. Match
-- threads appear on their own around each fixture and the open wall is a single
-- feed, so "has anyone got a spare for Saturday" had nowhere to live. That is
-- the one thing a Facebook group does that this did not.
--
-- Almost nothing new is needed to carry it. wall_posts.thread is already a
-- scope string holding 'pre:<fixture>' or 'post:<fixture>', indexed by
-- (thread, created_at desc). A topic is simply 'topic:<uuid>', which means
-- replies, likes, reports, hiding, moderation and the "somebody replied to you"
-- inbox all work on topics the day this lands, without a line of change: the
-- inbox joins a reply to its parent and never asks what thread they are in.

create table if not exists topics (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles on delete cascade,
  author_name  text not null,
  category     text not null check (category in
                 ('matchday','tickets','ground','memories','market','other')),
  title        text not null check (char_length(title) between 4 and 90),
  pinned       boolean not null default false,
  locked       boolean not null default false,
  hidden       boolean not null default false,
  reports      int not null default 0,
  created_at   timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);

-- The list is read in this order every time, so it is worth an index.
create index if not exists topics_active_idx
  on topics (pinned desc, last_post_at desc) where hidden = false;

comment on table topics is
  'Fan-started conversations. The posts themselves live in wall_posts under
   thread = ''topic:<id>'', which is why nothing else needed changing.';

alter table topics enable row level security;

-- Hidden topics are for the KTFCSA team only. Everything else is public,
-- because a conversation nobody can read is not much of one.
drop policy if exists "topics readable" on topics;
create policy "topics readable" on topics
  for select using (hidden = false or is_moderator());

-- No insert policy: start_topic() below is the only way in, so the rate limit
-- cannot be walked around by posting straight at the table.

-- The author may retitle their own topic. Moderators may do the rest.
drop policy if exists "edit own topic" on topics;
create policy "edit own topic" on topics
  for update
  using      (auth.uid() = profile_id or is_moderator())
  with check (auth.uid() = profile_id or is_moderator());

drop policy if exists "remove topic" on topics;
create policy "remove topic" on topics
  for delete using (auth.uid() = profile_id or is_admin());

-- ---- starting one ---------------------------------------------------------
--
-- Six new topics a day is generous for a supporter with something to say and
-- tight enough that a bad afternoon cannot bury the list. The count ignores
-- hidden ones deliberately: having a topic hidden should not buy you another.

create or replace function start_topic(p_category text, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id  uuid;
  mine  int;
  who   text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to start a topic';
  end if;

  select count(*) into mine
    from topics
   where profile_id = auth.uid()
     and created_at > now() - interval '24 hours';

  if mine >= 6 then
    raise exception 'That is six topics today. Have a reply instead, and come back tomorrow.';
  end if;

  select display_name into who from profiles where id = auth.uid();

  insert into topics (profile_id, author_name, category, title)
  values (auth.uid(), coalesce(who, 'Supporter'), p_category, btrim(p_title))
  returning id into t_id;

  -- The opening post is an ordinary wall post, which is the whole point.
  insert into wall_posts (profile_id, author_name, text, thread)
  values (auth.uid(), coalesce(who, 'Supporter'), p_body, 'topic:' || t_id);

  return t_id;
end;
$$;

revoke all on function start_topic(text, text, text) from public;
grant execute on function start_topic(text, text, text) to authenticated;

-- ---- keeping the order honest ---------------------------------------------
--
-- Sorting by when a topic was started puts a dead thread from last week above
-- one somebody answered this morning. Sorting by last activity is most of what
-- makes a place feel alive, and it costs one trigger.

create or replace function touch_topic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread like 'topic:%' then
    update topics
       set last_post_at = greatest(last_post_at, new.created_at)
     where id = substring(new.thread from 7)::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists on_topic_post on wall_posts;
create trigger on_topic_post
  after insert on wall_posts
  for each row execute function touch_topic();

-- ---- moderation -----------------------------------------------------------

create or replace function set_topic_state(p_topic uuid, p_field text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_moderator() then
    raise exception 'Not allowed';
  end if;
  if p_field not in ('pinned', 'locked', 'hidden') then
    raise exception 'Unknown field %', p_field;
  end if;
  execute format('update topics set %I = $1 where id = $2', p_field)
    using coalesce(p_on, false), p_topic;
end;
$$;

revoke all on function set_topic_state(uuid, text, boolean) from public;
grant execute on function set_topic_state(uuid, text, boolean) to authenticated;

-- A locked topic still reads, it just takes no more posts. Enforced here
-- rather than in the browser, where it would be a suggestion.
create or replace function guard_locked_topic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shut boolean;
begin
  if new.thread like 'topic:%' then
    select locked or hidden into shut
      from topics where id = substring(new.thread from 7)::uuid;
    if coalesce(shut, false) and not is_moderator() then
      raise exception 'That topic is closed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_topic_post_guard on wall_posts;
create trigger on_topic_post_guard
  before insert on wall_posts
  for each row execute function guard_locked_topic();

-- ---- the list -------------------------------------------------------------
--
-- Runs as owner so it can count posts and name authors without opening either
-- table up row by row.

drop view if exists topic_list cascade;
create view topic_list as
select
  t.id,
  t.profile_id,
  t.author_name,
  t.category,
  t.title,
  t.pinned,
  t.locked,
  t.reports,
  t.created_at,
  t.last_post_at,
  (select count(*) from wall_posts w
    where w.thread = 'topic:' || t.id and w.hidden = false) as posts,
  (select w.author_name from wall_posts w
    where w.thread = 'topic:' || t.id and w.hidden = false
    order by w.created_at desc limit 1) as last_author
from topics t
where t.hidden = false
order by t.pinned desc, t.last_post_at desc
limit 200;

alter view topic_list set (security_invoker = false);
grant select on topic_list to anon, authenticated;

-- ===========================================================================
-- Credit for work that happened away from the app
-- ===========================================================================
--
-- Darren Young wrote the pen pics for all nineteen players. That is one of the
-- largest single contributions anybody has made and none of it happened through
-- a form, so the points system could never see it. The same will be true of
-- whoever scans the first box of programmes.
--
-- An admin awards it by hand, with the reason recorded next to it, because a
-- points system nobody can explain is a points system nobody believes.

create table if not exists points_credits (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  reason     text not null check (char_length(reason) between 3 and 120),
  points     int  not null check (points between -500 and 500),
  awarded_by uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists points_credits_profile_idx on points_credits (profile_id);

comment on table points_credits is
  'Points awarded by hand for work done away from the app. The reason is shown
   to the supporter on their own card, so it is written to be read.';

alter table points_credits enable row level security;

-- Readable by everyone: it is part of a public total, and a total you cannot
-- account for is worse than no total.
drop policy if exists "credits readable" on points_credits;
create policy "credits readable" on points_credits for select using (true);

drop policy if exists "admins award credit" on points_credits;
create policy "admins award credit" on points_credits
  for insert with check (is_admin());

drop policy if exists "admins withdraw credit" on points_credits;
create policy "admins withdraw credit" on points_credits
  for delete using (is_admin());

-- ===========================================================================
-- Dormant accounts
-- ===========================================================================
--
-- A few supporters signed up twice and use one of the two. The spare sits on
-- every board on nought and clutters the list of people, and clicking it shows
-- a profile with nothing in it. Deleting it would take their sign-in with it,
-- so it is hidden instead: still theirs, still able to sign in, simply not
-- listed. Reversible, which deleting is not.

alter table profiles add column if not exists dormant boolean not null default false;

comment on column profiles.dormant is
  'A duplicate or abandoned account. Hidden from boards and from the people
   list. Never deleted: the sign-in still belongs to somebody.';

create or replace function set_dormant(target uuid, hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not allowed';
  end if;
  update profiles set dormant = coalesce(hidden, false) where id = target;
end;
$$;

revoke all on function set_dormant(uuid, boolean) from public;
grant execute on function set_dormant(uuid, boolean) to authenticated;

-- ===========================================================================
-- Poppies Points
-- ===========================================================================
--
-- Worked out, never stored. poppies_daily_league already computes streaks in a
-- view rather than keeping a column, and the same reasoning applies here: no
-- ledger to drift out of step, no backfill when a weight changes, and changing
-- what something is worth is one edit to this file rather than a recount.
--
-- Two things this is deliberately not:
--
--   * It never touches anybody's say. Not the consultation, not polls, not
--     anything the Association reports. The published value is that nobody's
--     say counts for more than anyone else's, and a points total must not
--     quietly undercut it. No consultation or poll query reads this view.
--
--   * It is not a measure of being a supporter. It counts what somebody has
--     put into the app. A fan of forty years who never fills in a form is not
--     mid-table, and the page that shows this says so in as many words.
--
-- The weights favour usefulness over volume. A ground report helps every away
-- fan who comes after you and is worth ten; a wall post is worth one and caps
-- out at ten a day, so nobody can type their way to the top. A like received
-- is worth three, which makes what other people thought of a post worth more
-- than having written it.

create or replace function season_start()
returns date
language sql
stable
as $$
  -- Seasons run July to May. Anything from 1 July belongs to the season that
  -- takes that year's name.
  select make_date(
    case when extract(month from london_today()) >= 7
         then extract(year from london_today())::int
         else extract(year from london_today())::int - 1 end,
    7, 1);
$$;

grant execute on function season_start() to anon, authenticated;

-- Everything below counts this season only, from season_start(). A board that
-- never resets is owned by whoever joined first, and somebody signing up in
-- January can never catch them however much they put in. Badges are the place
-- for a lifetime record, and they are worked out separately.
--
-- Two sources are left out rather than guessed at. pub_votes keeps no date at
-- all, so it cannot be attributed to a season; duel_scores keeps a running
-- total of plays with only the last date, so counting it would hand this
-- season every play since the game launched. Both are small, and a wrong
-- number is worse than a missing one.

-- pub_votes was the one contribution with no date on it at all, so it could not
-- be attributed to a season. Rather than leave it out, give it one. Votes cast
-- before today have no date and simply do not count this season, which is
-- honest: nothing recorded when they happened.
alter table pub_votes add column if not exists created_at timestamptz default now();

-- Everything below counts this season only, from season_start(). A board that
-- never resets is owned by whoever joined first, and somebody signing up in
-- January can never catch them however much they put in. Badges are the place
-- for a lifetime record, and they are worked out separately.
--
-- duel_scores is still left out: it keeps a running total of plays with only
-- the date of the last one, so counting it would hand this season every play
-- since the game launched. A wrong number is worse than a missing one.
--
-- If a weight changes here it changes in my_points() and in data/points.json
-- too, or a supporter sees one total on the board, a different one on their own
-- card, and a third explanation on the page telling them how it works.

drop view if exists supporter_points cascade;
create view supporter_points as
with
  -- The most work, and the most use to everybody who comes after you.
  reports as (
    select profile_id, count(*) * 10 as pts from ground_reports
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 10 from access_reports
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 10 from parking_reports
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 10 from price_reports
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, 15 from archive_offers
      where created_at >= season_start()
    union all
    select profile_id, 10 from consultation_responses
      where profile_id is not null and created_at >= season_start()
  ),
  -- Doing something that helps other supporters get to a game.
  organising as (
    select profile_id, count(*) * 8 as pts from pubs
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 8 from coach_notices
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 5 from lifts
      where profile_id is not null and created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 3 from topics
      where hidden = false and created_at >= season_start() group by profile_id
  ),
  turning_up as (
    select profile_id, count(*) * 3 as pts from attendance
      where created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 2 from ground_visits
      where created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 2 from predictions
      where created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 2 from quiz_results
      where quiz_date >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 2 from wordle_results
      where play_date >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 1 from poll_votes
      where created_at >= season_start() group by profile_id
    union all
    select profile_id, count(*) * 1 from pub_votes
      where created_at >= season_start() group by profile_id
    -- Per match, not per player: marking a full eleven is one contribution,
    -- not eleven, and weighting it by squad size would be daft.
    union all
    select profile_id, count(distinct fixture_id) * 5 from player_ratings
      where created_at >= season_start() group by profile_id
    -- Telling us something is broken is worth something, and worth something
    -- five times rather than fifty.
    union all
    select profile_id, least(count(*), 5) * 2 from feedback
      where profile_id is not null and created_at >= season_start() group by profile_id
  ),
  -- Posting is worth something, but only up to a point: ten a day, so a long
  -- argument is not a scoring opportunity.
  posting as (
    select profile_id, sum(capped) as pts from (
      select profile_id, least(count(*), 10) as capped
        from wall_posts
       where hidden = false and created_at >= season_start()
       group by profile_id, date_trunc('day', created_at)
    ) d group by profile_id
  ),
  -- What other people made of it, which is worth more than having written it.
  liked as (
    select w.profile_id, count(*) * 3 as pts
      from wall_likes l
      join wall_posts w on w.id = l.post_id
     where w.hidden = false
       and l.profile_id <> w.profile_id      -- liking yourself is not a signal
       and l.created_at >= season_start()
     group by w.profile_id
  ),
  -- And what the moderators made of it. Costs more than it earned.
  hidden_cost as (
    select profile_id, count(*) * -10 as pts
      from wall_posts
     where hidden = true and created_at >= season_start() group by profile_id
  ),
  -- Work done away from the app, awarded by hand. Darren Young's pen pics are
  -- the reason this exists.
  credited as (
    select profile_id, sum(points)::int as pts from points_credits
     where created_at >= season_start() group by profile_id
  ),
  all_pts as (
    select * from reports    union all
    select * from organising union all
    select * from turning_up union all
    select * from posting    union all
    select * from liked      union all
    select * from credited   union all
    select * from hidden_cost
  )
select
  p.id            as profile_id,
  p.display_name,
  greatest(coalesce(sum(a.pts), 0), 0)::int as points
from profiles p
left join all_pts a on a.profile_id = p.id
where p.dormant = false          -- a spare account is not a competitor
group by p.id, p.display_name;

alter view supporter_points set (security_invoker = false);
grant select on supporter_points to anon, authenticated;

-- The board. Capped at fifty like the others, and it shows nobody on zero:
-- appearing last on a list you never joined is not encouragement.
drop view if exists contributor_board cascade;
create view contributor_board as
select profile_id, display_name, points
  from supporter_points
 where points > 0
 order by points desc, display_name
 limit 50;

alter view contributor_board set (security_invoker = false);
grant select on contributor_board to anon, authenticated;

-- ---- where your own points came from --------------------------------------
--
-- A total on its own tells you nothing about what to do next. This breaks it
-- down for the supporter asking, and only for them.

create or replace function my_points()
returns table (source text, points int)
language sql
stable
security definer
set search_path = public
as $$
  -- The same season window and the same weights as supporter_points. If these
  -- two ever disagree, a supporter sees one total on the board and a different
  -- one on their own card, so they are edited together or not at all.
  select 'Ground and away-day reports', (
    (select count(*) from ground_reports  where profile_id = auth.uid() and created_at >= season_start()) +
    (select count(*) from access_reports  where profile_id = auth.uid() and created_at >= season_start()) +
    (select count(*) from parking_reports where profile_id = auth.uid() and created_at >= season_start()) +
    (select count(*) from price_reports   where profile_id = auth.uid() and created_at >= season_start()))::int * 10
  union all
  select 'The archive project',
    (select count(*) from archive_offers
      where profile_id = auth.uid() and created_at >= season_start())::int * 15
  union all
  select 'The consultation',
    (select count(*) from consultation_responses
      where profile_id = auth.uid() and created_at >= season_start())::int * 10
  union all
  select 'Getting other people to games',
    ((select count(*) from pubs
       where profile_id = auth.uid() and created_at >= season_start()) * 8 +
     (select count(*) from coach_notices
       where profile_id = auth.uid() and created_at >= season_start()) * 8 +
     (select count(*) from lifts
       where profile_id = auth.uid() and created_at >= season_start()) * 5)::int
  union all
  select 'Starting conversations',
    (select count(*) from topics
      where profile_id = auth.uid() and hidden = false and created_at >= season_start())::int * 3
  union all
  select 'Games at the ground',
    (select count(*) from attendance
      where profile_id = auth.uid() and created_at >= season_start())::int * 3
  union all
  select 'Grounds ticked off',
    (select count(*) from ground_visits
      where profile_id = auth.uid() and created_at >= season_start())::int * 2
  union all
  select 'Rating the players',
    (select count(distinct fixture_id) from player_ratings
      where profile_id = auth.uid() and created_at >= season_start())::int * 5
  union all
  select 'Predictions and the daily games',
    ((select count(*) from predictions
       where profile_id = auth.uid() and created_at >= season_start()) * 2 +
     (select count(*) from quiz_results
       where profile_id = auth.uid() and quiz_date >= season_start()) * 2 +
     (select count(*) from wordle_results
       where profile_id = auth.uid() and play_date >= season_start()) * 2)::int
  union all
  select 'Votes and recommendations',
    ((select count(*) from poll_votes
       where profile_id = auth.uid() and created_at >= season_start()) +
     (select count(*) from pub_votes
       where profile_id = auth.uid() and created_at >= season_start()))::int
  union all
  select 'Telling us what is broken',
    (select least(count(*), 5) from feedback
      where profile_id = auth.uid() and created_at >= season_start())::int * 2
  union all
  select 'On the wall',
    coalesce((select sum(least(c, 10)) from (
      select count(*) as c from wall_posts
       where profile_id = auth.uid() and hidden = false and created_at >= season_start()
       group by date_trunc('day', created_at)) d), 0)::int
  union all
  select 'Likes from other supporters',
    (select count(*) from wall_likes l join wall_posts w on w.id = l.post_id
      where w.profile_id = auth.uid() and w.hidden = false
        and l.profile_id <> w.profile_id
        and l.created_at >= season_start())::int * 3
  union all
  select coalesce((select string_agg(distinct reason, ', ') from points_credits
                    where profile_id = auth.uid() and created_at >= season_start()),
                  'Awarded by hand'),
    coalesce((select sum(points) from points_credits
               where profile_id = auth.uid() and created_at >= season_start()), 0)::int
  union all
  select 'Posts hidden by a moderator',
    (select count(*) from wall_posts
      where profile_id = auth.uid() and hidden = true
        and created_at >= season_start())::int * -10;
$$;

revoke all on function my_points() from public;
grant execute on function my_points() to authenticated;

-- ===========================================================================
-- Poppies Wordle
-- ===========================================================================
--
-- Built the same way as Poppies Daily: one puzzle a day, one attempt per
-- supporter, and the marks string kept so the shareable grid survives the round
-- trip. The word length varies day to day, which is why it is stored: a grid
-- cannot be redrawn without knowing how wide it was.

create table if not exists wordle_results (
  profile_id uuid not null references profiles on delete cascade,
  play_date  date not null,
  word_len   int  not null check (word_len between 4 and 9),
  guesses    int  not null check (guesses between 1 and 7),
  solved     boolean not null,
  -- One character per guessed letter, in order: 2 right place, 1 wrong place,
  -- 0 not in the word. Length is guesses * word_len.
  marks      text not null check (marks ~ '^[012]+$' and char_length(marks) <= 63),
  created_at timestamptz not null default now(),
  primary key (profile_id, play_date)
);

create index if not exists wordle_date_idx on wordle_results (play_date desc);

comment on table wordle_results is
  'One Poppies Wordle per supporter per day. Streaks are worked out in the view
   below, never stored, same as the quiz.';

alter table wordle_results enable row level security;

-- Public for the same reason the quiz is: a date and a number of guesses says
-- no more than the board it feeds.
drop policy if exists "wordle results are public" on wordle_results;
create policy "wordle results are public" on wordle_results for select using (true);

-- No insert policy. record_wordle() checks the day is real and that the marks
-- match the shape claimed, which a policy cannot.

create or replace function record_wordle(
  p_date date, p_len int, p_guesses int, p_solved boolean, p_marks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;   /* playing signed out is fine, it just does not count */
  end if;

  -- No filling in tomorrow, and no quietly backdating a streak. Sixty days
  -- back matches the window the quiz allows for a guest carrying results over.
  if p_date > london_today() or p_date < london_today() - 60 then
    raise exception 'That is not a day you can play';
  end if;

  -- The grid has to be the size it says it is, or the share is a fiction.
  if char_length(p_marks) <> p_guesses * p_len then
    raise exception 'That result does not add up';
  end if;

  insert into wordle_results (profile_id, play_date, word_len, guesses, solved, marks)
  values (auth.uid(), p_date, p_len, p_guesses, coalesce(p_solved, false), p_marks)
  on conflict (profile_id, play_date) do nothing;   -- first go is the one that counts
end;
$$;

revoke all on function record_wordle(date, int, int, boolean, text) from public;
grant execute on function record_wordle(date, int, int, boolean, text) to authenticated;

-- The board. Ranked on the current unbroken run of solved days, then on how
-- few guesses it took, so somebody who solves in three beats somebody who
-- scrapes home in six.
drop view if exists wordle_league cascade;
create view wordle_league as
with runs as (
  select
    r.profile_id,
    r.play_date,
    r.solved,
    r.guesses,
    -- Consecutive solved days share a value here, which is what makes a streak
    -- countable without storing it.
    r.play_date - (row_number() over (partition by r.profile_id order by r.play_date))::int
      as run_key
  from wordle_results r
  where r.solved
),
best as (
  select profile_id, run_key, count(*) as len, max(play_date) as ends, avg(guesses) as avg_g
    from runs group by profile_id, run_key
),
latest as (
  select distinct on (profile_id) profile_id, len, ends, avg_g
    from best order by profile_id, ends desc
)
select
  c.profile_id,
  p.display_name,
  case when c.ends >= london_today() - 1 then c.len else 0 end as streak,
  (select count(*) from wordle_results w where w.profile_id = c.profile_id and w.solved) as solved,
  round(c.avg_g, 2) as avg_guesses
from latest c
join profiles p on p.id = c.profile_id
order by streak desc, avg_guesses asc, solved desc
limit 50;

alter view wordle_league set (security_invoker = false);
grant select on wordle_league to anon, authenticated;

-- ===========================================================================
-- Grounds visited, by supporter
-- ===========================================================================
--
-- ground_visit_counts already exists but groups the other way, by club, which
-- answers "how many of us have been to Leiston" rather than "who has been to
-- the most grounds". The Standing page needs the second question, and it is a
-- board a lot of people can top without ever touching a keyboard.

drop view if exists ground_board cascade;
create view ground_board as
select
  g.profile_id,
  p.display_name,
  count(*)::int as grounds
from ground_visits g
join profiles p on p.id = g.profile_id
where p.dormant = false
group by g.profile_id, p.display_name
having count(*) > 0
order by grounds desc, p.display_name
limit 50;

alter view ground_board set (security_invoker = false);
grant select on ground_board to anon, authenticated;

-- ===========================================================================
-- Choosing your own kit
-- ===========================================================================
--
-- The avatar's colour and pattern were both worked out from a hash of the
-- supporter's display name. That gave everybody something rather than a row of
-- identical grey circles, but it also meant nobody could change theirs, and
-- two people who liked the look of a kit could not both have it.
--
-- Both are now a choice, stored per profile. Null means "work it out from the
-- name", which is what everybody has until they pick, so nothing changes for
-- anybody who never opens the picker.
--
-- avatar_kit holds a hex colour rather than an index into a list. An index
-- would have tied every supporter's choice to the order of an array in the
-- browser, and reordering that array would have quietly restyled the fanbase.

alter table profiles add column if not exists avatar_kit text
  check (avatar_kit is null or avatar_kit ~ '^#[0-9a-fA-F]{6}$');

alter table profiles add column if not exists avatar_pattern text
  check (avatar_pattern is null or avatar_pattern in
    ('plain', 'stripes', 'hoops', 'halves', 'quarters', 'sash'));

comment on column profiles.avatar_kit is
  'Chosen avatar colour as #rrggbb. Null means derive it from the name.';
comment on column profiles.avatar_pattern is
  'Chosen avatar pattern. Null means derive it from the name.';

-- The existing "own profile update" policy already covers these: a supporter
-- may change their own row and nobody else's. No new policy, and deliberately
-- no function, because there is nothing here worth guarding beyond that.
