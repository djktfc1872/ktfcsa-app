# Poppies Fan Companion

The Kettering Town FC Supporters' Association fan app.

A web app for Kettering Town Supporters' Association. Fixtures, results and the
league table look after themselves. Ground guides, coach travel, car shares, the
fan wall and The Poppycast sit around them.

It is a plain HTML, CSS and JavaScript app. There is no build step, no framework
and nothing to pay for.

---

## What updates on its own

| Part | Where it comes from | How often |
| --- | --- | --- |
| Fixtures, kick-off times, results, postponements | Southern League public API | Every 20 minutes on match days, twice daily otherwise |
| FA Cup, FA Trophy, Senior Cup and Challenge Cup ties | Southern League public API | Appear on their own once the draw is made |
| League table | Southern League public API | Same as above |
| Prediction league and attendance totals | Worked out in the database as results land | Instantly |
| Poppycast episodes | The Poppycast RSS feed | Live in the browser, mirrored on each data run |

The only thing an administrator updates by hand is the **coach travel notice**.

### How the automation works

The Southern League runs its own public API at `api.southern-football-league.co.uk`.
It is free and needs no key, but it only accepts browser requests from its own
website. So the app cannot call it directly.

Instead, a GitHub Action runs on a schedule, fetches the data from a server
(where that restriction does not apply), and commits the result to
`data/league.json`. The app reads that file from its own domain. If a fixture is
moved or a game is called off, the next run picks it up and every supporter's app
updates with no action from anyone.

`.github/workflows/update-data.yml` is the schedule.
`scripts/fetch-league.mjs` and `scripts/fetch-podcast.mjs` do the fetching.

You can also run either by hand:

```bash
node scripts/fetch-league.mjs
```

Or from the repository's **Actions** tab, using **Run workflow**.

---

## Deploying to Cloudflare Pages

The app is served at **app.ktfcsa.com**. Cloudflare Pages watches the GitHub
repository, so every time the scheduled job commits new fixture data the site
redeploys itself.

### 1. Push to GitHub

Create an empty repository at <https://github.com/new> called `ktfcsa-app`,
with no README and no licence, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/ktfcsa-app.git
git push -u origin main
```

### 2. Let the data job write back

GitHub repo -> Settings -> Actions -> General -> **Workflow permissions** ->
**Read and write permissions** -> Save. Without this the fixture updates cannot
commit themselves.

### 3. Connect Cloudflare Pages

Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> **Connect to Git**
-> pick `ktfcsa-app`. Then:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *leave empty* |
| Build output directory | `/` |
| Production branch | `main` |

There is no build step, so Cloudflare just serves the files.

### 4. Point the subdomain at it

In the Pages project -> **Custom domains** -> Set up a custom domain ->
`app.ktfcsa.com`. If ktfcsa.com is already on Cloudflare the DNS record is
created for you and the certificate follows within a minute or two.

`_headers` in the project root sets the caching and security headers, including
a content security policy. It is applied automatically.

---

## Before you launch

Work through **Accounts, predictions and attendance** below. Until Supabase is
connected the app still runs, but it keeps everything on one device and the
prediction league, attendance tracking and pub suggestions stay switched off.

The only value in `assets/js/config.js` that is a secret of any kind is
`localAdminPasscode`, and that is used only when Supabase is not connected.
Everything in that file is visible to anyone who views the page source, so never
put anything genuinely private there.

---

## Administrator guide

Once somebody has `is_admin` ticked on their profile, three things unlock in the
app itself.

**Coach travel.** Travel -> Coach travel -> *Add a coach notice*. Pick the match,
fill in departure time, pick-up point, fare and who to book with. Edit or remove
it any time. This is the one weekly job.

**Polls.** Fan Wall -> *Create a poll*. Two to four options. Supporters vote once
each, and results show as soon as they have voted.

**Moderation.** Fan wall posts gain *Hide* and *Delete*, and pub suggestions gain
*Remove*. Supporters can report posts, which flags them for you.

Everything else is edited in the Supabase Table Editor, described below.

---

## Accounts, predictions and attendance

Out of the box the app runs on one device with a nickname, so you can try it
immediately. Supporter accounts, the prediction league, attendance tracking and
pub recommendations all need Supabase, which is free.

### Setting it up

**1. Create the project.** Go to <https://supabase.com>, create a project, and
pick a region near you (London is `eu-west-2`). Keep the database password
somewhere safe; you will not need it for the app.

**2. Create the tables.** Open **SQL Editor**, click **New query**, paste the
whole of `supabase/schema.sql` from this repository, and press **Run**. That
creates every table, the security rules, and the two views that do the counting.
It is safe to run again later.

**3. Turn off email confirmation.** Authentication -> Sign In / Providers ->
Email, and switch **Confirm email** off. Supabase's built-in mail is rate
limited to a handful an hour, which would otherwise block people joining on a
match day. Supporters sign up with an email address and a password, and are
signed in straight away.

**4. Point the app at it.** Settings -> API gives you the Project URL and the
`anon` public key. Put both in `assets/js/config.js`:

```js
supabase: {
  url: "https://yourproject.supabase.co",
  anonKey: "eyJhbGci…",
},
```

The anon key is designed to be public. The row level security policies in
`schema.sql` are what protect the data.

**5. Let the fixture sync write to the database.** In your GitHub repository,
Settings -> Secrets and variables -> Actions, add two secrets:

| Secret | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Supabase -> Settings -> API -> Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase -> Settings -> API -> `service_role` key |

The service role key bypasses all security rules, so it lives only in GitHub
Secrets and never in the app.

Once set, the scheduled job pushes every fixture into Supabase alongside the
JSON file. That is what scores the prediction league, and it doubles as the
keep-alive that stops a free Supabase project pausing.

### Making somebody a committee admin

There is no passcode in the online setup. Open **Table Editor -> profiles**,
find the person, and tick `is_admin`. That is the whole job. They can then post
coach notices, run polls, moderate the wall and hide pub suggestions.

### Your admin backend

The Supabase dashboard is the backend you asked for. **Table Editor** is a
spreadsheet view of every table: edit a coach notice, delete a wall post, fix a
typo in somebody's display name, all without touching code. Useful tables:

- `profiles` - who has joined, and who is an admin
- `coach_notices` - the weekly coach details
- `pubs` - supporter pub suggestions, with a `hidden` flag
- `feedback` - what supporters have sent the committee, with a `handled` flag
- `wall_posts` - the fan wall, also with `hidden`
- `fixtures` - written by the sync job; you should not need to touch it

### How predictions handle fixture changes

Predictions attach to the Southern League's match id, not to a date. Every sync
rewrites each fixture's kick-off time, and the database refuses a prediction
once that time has passed.

So if a game is postponed and rescheduled, the prediction follows the fixture
and the window simply reopens at the new time. If a match is abandoned it stops
being counted, because scoring only looks at fixtures marked as played. Cup ties
appear on their own when the draw is made and can be predicted like any other
game.

### Scoring

Three points for the exact score, one for the right result. Change it in
`config.js` for the display, and in the `prediction_league` view in
`schema.sql` for the actual sums.

---

## Updating the club data

Ground details, ticket prices, parking, pubs and factoids come from the master
spreadsheet, not from any feed. When the spreadsheet changes, regenerate the data
file rather than editing it by hand:

```bash
python3 scripts/gen-teams.py "/path/to/KTFCSA App Base MASTER Data.xlsx"
```

That rewrites `assets/js/data.js`. Commit it and the site picks it up.

The spreadsheet is the single source of truth for this data. Nothing in the app
alters it.

---

## Files

```
index.html                     the shell
_headers                       Cloudflare caching and security headers
manifest.webmanifest           lets supporters install it to a home screen
sw.js                          offline support for away trips with no signal
supabase/schema.sql            tables, security rules and the scoring views
assets/css/app.css             design system, built on the crest colours
assets/js/app.js               views and routing
assets/js/data.js              generated from the master spreadsheet
assets/js/store.js             accounts, saved posts, predictions, attendance
assets/js/supabase.js          the Supabase driver, loaded only when configured
assets/js/config.js            settings an administrator may change
data/league.json               fixtures and table, updated automatically
data/podcast.json              podcast mirror, updated automatically
scripts/gen-teams.py           spreadsheet to data.js
scripts/dev-server.py          local preview with caching turned off
scripts/fetch-league.mjs       Southern League to league.json
scripts/fetch-podcast.mjs      RSS to podcast.json
.github/workflows/             the update schedule
```

---

## Credits

Fixtures, results and the league table come from the Southern League. The
Poppycast is a fan-led podcast and a partner of KTFCSA. Ground, ticket and travel
details come from the KTFCSA master spreadsheet.
