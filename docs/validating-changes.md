# What gets validated before it goes out

There is one person writing this app, one person reviewing it, and four hundred
supporters on the other end. This is how a change gets from an idea to the live
site without that being reckless.

It is deliberately not a process for everything. Most changes are a line of copy
or a colour, and putting those through a review queue would mean the queue gets
ignored for the ones that matter.

---

## Which lane a change is in

Decide this **before** writing it, not after. The question is not how big the
change is, it is what happens if it is wrong.

### Lane 1 — ship it

Copy, a colour, a label, a fixed date, one club's parking notes. Wrong is
embarrassing and fixed in five minutes.

Straight to `main`. No sign-off.

### Lane 2 — Ed looks at it

Anything a supporter touches: a new page, a form, a game, a change to the fan
wall, anything that saves what somebody typed.

Goes out, and the change is added to the test run as a batch: what shipped, and
what each check should look like when it is right. Ed clears it, the batch comes
off, and the page goes quiet until the next one. It only ever lists new work, so
it is never a backlog of things nobody is going to look at.

Shipping first is the right call here because the app has one of everything and
no realistic way to reproduce four hundred people on a Saturday.

### Lane 3 — validated before it goes near the live site

Four kinds of change, and all four have already bitten this month:

- **Anything touching money, permissions or who can see what.** The fan wall
  update policy let any signed-in supporter rewrite anybody's post for weeks.
- **Anything that deletes or overwrites in bulk.** Saving the question workbench
  deletes every group and reinserts them. One bad save takes the twelve
  questions to the club with it.
- **Anything on the consultation, the letters or the questions.** The club reads
  those pages. An error there is not a bug, it is a own goal in a dispute.
- **Anything where the app tells a supporter a fact.** Prices, postcodes, dates,
  counts. "Asked by 0 supporters" and ten pubs pointing at the wrong ground were
  both this.

These wait for the test instance, and for Ed.

---

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

7. **For schema: is the `alter table` above the view that reads the column?**
   The file runs top to bottom. It works on your database because the column is
   already there from last time, and fails on a fresh one. Three times.

8. **After deploying, fetch the live file and grep it.** Not the browser, which
   lies via its cache. `curl` the deployed asset and check the thing you changed
   is in it.

---

## Getting a change to Ed

Until the test instance is up, Lane 2 goes to the live site and Ed is told what
changed. That is a real compromise and worth naming: he is testing in front of
supporters.

Once it is up:

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
