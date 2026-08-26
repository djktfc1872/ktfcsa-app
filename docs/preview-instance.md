# A test instance for UAT

Two halves, both on your accounts: a second place to serve the app, and a
second database for it to write to. The code side is already done and deployed —
it picks its database from the address it is served from, and falls back to
production until a preview project exists, so nothing changes until you do this.

---

## 1. A second Supabase project (the important half)

Without this, a test site writes to the live fan wall. The banner turns red and
says so, but it is still writing.

1. Supabase → **New project**. Call it something unmistakable, `ktfcsa-preview`.
   Same region as the live one.
2. Open its **SQL editor** and run `supabase/schema.sql` whole. That is the same
   file you have been running all week; it builds everything from nothing.
3. **Settings → API**: copy the **Project URL** and the **publishable key**.
4. In **Authentication → URL Configuration**, set the site URL to the preview
   address from step 2 below, or password reset on the test site will send
   people to the live one.

It starts empty. That is the point: no real supporters, no real posts, and Ed
can be made an admin on it without being able to touch anything that matters.

## 2. Somewhere to serve it

Cheapest first, and the first one may be all you need.

**Option A — Cloudflare preview URLs.** Workers gives every version a preview
URL of its own without touching production. Cloudflare dashboard → the
`ktfcsa-app` Worker → **Deployments**, and enable preview URLs. You get a
`<hash>-ktfcsa-app.<subdomain>.workers.dev` address. Nothing to build or
maintain, and the address changes with each version.

**Option B — a branch that deploys itself.** If Ed wants one stable address:
create a `preview` branch, and in the Worker's **Builds** settings add it as a
non-production branch. Cloudflare then deploys that branch to its own preview
URL on every push, and I can push work there for him to test before it goes to
`main`.

**Option C — a subdomain.** `preview.ktfcsa.com`, pointed at whichever of the
above you pick. Nicest to share, one more DNS record to keep straight. Worth
doing only once the other two have proved they work.

## 3. Tell the app about it

One edit, in `assets/js/config.js`:

```js
preview: {
  url: "https://<the preview project>.supabase.co",
  anonKey: "sb_publishable_<the preview key>",
},
```

Send it to me and I will put it in, or paste it yourself. From that moment any
host that is not `fans.ktfcsa.com`, `ktfcsa.com` or `www.ktfcsa.com` uses the
preview database and wears a gold **Test site** band across the top.

## 4. Make Ed an admin — on the preview only

On the **preview** project, in its SQL editor, after he has signed up there:

```sql
update profiles set is_admin = true
 where display_name = 'Ed P';
```

He then has the full admin panel, the question workbench, the moderation
queue and the points controls, on a database where breaking any of it costs
nothing.

---

## What I could not do

The Cloudflare and Supabase steps need your accounts. `wrangler` has no API
token here and I will not ask you for one. Everything in the repo is done.

## One thing to decide

Preview being empty is right for testing the app, and wrong for testing the
report, the questions or the archive, which only look like anything with data
behind them. If Ed needs those, the honest options are to seed the preview with
a handful of made-up rows, or to accept those particular screens get tested on
production read-only. I would seed it — say the word and I will write the seed
script.
