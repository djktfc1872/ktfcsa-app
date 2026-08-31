# How work gets out

One person writing this app, four hundred supporters on the other end, and a
season that does not wait. Work ships when it is done.

This is not a queue and not a sign-off. It is the short list of checks that
have each caught something real here, and a note of when to ask for more than
that.

---

## What gets held back

Nothing, unless Danny says so.

Decided 31 August 2026, and it is a deliberate trade rather than a corner cut.
The app has one of everything and no way to rehearse four hundred supporters on
a Saturday, so most bugs are only findable in front of people. Holding work back
to be checked first bought less than it cost.

So: **work goes to `main` when it is done.** Ed tests the live site afterwards
and anything he finds gets fixed or backed out the same day. The test run
becomes a record of what has just changed rather than a gate in front of it.

**Ask for a gate when you want one.** Say so and a change waits: the sort of
thing worth it is anything the club reads, anything touching money, or anything
that rewrites rows in bulk. That is a judgement call each time now, not a
standing rule, and it belongs to Danny rather than to this file.

What has not changed is the checking below. None of it is a gate and none of it
costs anybody a wait: it is the work of not shipping something obviously broken,
and every line of it is on the list because it caught a real fault here.

## The checks that actually catch things

In the order they cost, cheapest first. Every one of these has caught a real
bug here, which is why it is on the list and nothing else is.

1. **Parse it as a module.** `node --check` on a `.js` file checks it as a
   script, and passes things that break the app on load. Copy to `.mjs` first.
   A missed comma in a class body once took sign-in down for everybody and
   parsed cleanly the whole time.

2. **Read the diff before committing.** `git diff`, every time. A
   find-and-replace hit the wrong occurrence twice in one day: once renaming a
   CSS class that turned out to be the consultation's status grid, once moving a
   stat grid that landed in the head-to-head panel. Both were invisible in the
   code and obvious in the diff.

3. **If a check keeps being needed, put it in the shape of the code instead.**
   A node built by `el()` is detached until the caller appends it, so a timer
   that guards itself with "stop if my node has gone" stops before it starts.
   That was written three times in a week and fixed three times by remembering
   to. It is now `tickWhileOnPage(node, fn, ms)`, where the first run happens
   outside the guard and there is nothing left to remember. A rule nobody can
   forget beats a rule on this list.

4. **Run it and look at it.** Not "it should render" — open the page. Half the
   problems this month were things that rendered without error and were wrong:
   a scarf that read as a horseshoe, a fourth stat tile orphaned on its own row,
   a fold containing nothing.

5. **Check it against real data, not a happy path.** A test row is not a
   supporter. The letters page looked finished until it was opened with two
   letters in it and turned out to be two collapsed folds and nothing else.

6. **Check the empty state and the loading state.** They are different things
   and they were rendered identically on the profile page, so anybody opening a
   profile by its link was told there was nothing to show while it loaded.

7. **For schema, run the check rather than reading the file.**
   `node scripts/check-schema.mjs`. The file runs top to bottom, and on the one
   database that matters everything it needs is already there from last time, so
   an out-of-order file passes every run and fails only on a fresh project or a
   restore. Reading for it caught four; writing the check found four more that
   nobody had spotted, including a policy on `profiles.avatar` three hundred
   lines above the column.

8. **After deploying, fetch the live file and grep it.** Not the browser, which
   lies via its cache. `curl` the deployed asset and check the thing you changed
   is in it.

---

## Getting a change to Ed

Ed tests the live site. He is testing in front of supporters, which is the
trade being made knowingly rather than a thing nobody noticed.

Once there is a test instance, the same list can be worked through there first
where it suits, without holding anything back:

1. Work lands on the `preview` branch, which deploys itself to the preview URL
   against the preview database.
2. Ed gets the URL and what to look at. The **Test site** band across the top
   tells him which one he is on, and the checklist tells him what to try.
3. He passes it or flags it with what he saw, what phone, what browser.
4. It merges to `main`.

The setup is in [preview-instance.md](preview-instance.md).

---

## When something is wrong on the live site

1. **Back it out first, work out why second.** `git revert`, push, done in two
   minutes. Debugging with it live is a choice to leave it broken while you
   think.
2. **Say so.** If supporters saw it, say what happened on the wall. This app's
   whole argument to the club is about communication.
3. **Write the check that would have caught it.** The list above is entirely
   made of things that went wrong once. That is the only reason it is worth
   reading.

---

## Two things this process does not cover

**The schema.** Every change to `supabase/schema.sql` is run by hand, by Danny,
against the live database, from a file sent over chat. There is no staging and
no undo. The mitigation today is that the file is written to be re-runnable from
nothing and is read before it is run. A preview project gives it somewhere to be
rehearsed, and that is the strongest argument for standing one up.

**The data bot.** `Update data` commits land on `main` on their own several
times a day, straight from the league feed. Nobody reviews those. A bad feed
goes live unreviewed, which is fine for a fixture list and would not be fine if
that job ever wrote anything a supporter had typed.
