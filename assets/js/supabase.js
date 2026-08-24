/* Supabase driver.

   Loaded only when config.js has a project URL. Everything it exposes is
   promise based; store.js keeps a synchronous cache on top so the views can
   still render in one pass. */

import { CONFIG } from "./config.js";

/* Vendored rather than fetched from esm.sh at runtime. A CDN serving the code
   that handles sign-in is a third party with execution on the page, and pinning
   a version does not help if the CDN itself is compromised. Same reasoning as
   Leaflet next door. Update by re-downloading, not by editing. */
const SDK = "../vendor/supabase.mjs";

/* Board name used by the app -> table name in Postgres. */
export const TABLES = {
  coach: "coach_notices",
  lift: "lifts",
  wall: "wall_posts",
  poll: "polls",
};

export async function connect() {
  const { createClient } = await import(SDK);
  const client = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return new Backend(client);
}

class Backend {
  constructor(client) {
    this.sb = client;
    this.profile = null;
  }

  /* ------------------------------------------------------------- accounts */

  async restore() {
    const { data } = await this.sb.auth.getSession();
    if (data?.session) await this.loadProfile(data.session.user.id);
    return this.profile;
  }

  async loadProfile(id) {
    const { data, error } = await this.sb
      .from("profiles")
      .select("id, display_name, is_admin")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    this.profile = data
      ? { id: data.id, name: data.display_name, isAdmin: data.is_admin }
      : null;
    return this.profile;
  }

  async signUp(email, password, displayName, { emails = false } = {}) {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw new Error(friendly(error));
    if (!data.session) {
      throw new Error("Check your inbox to confirm your address, then sign in.");
    }
    /* Consent is recorded only if it was actually given. Unticked is a valid
       answer and stays the default. */
    if (emails) {
      await this.sb.from("profiles").update({ email_opt_in: true }).eq("id", data.user.id);
    }

    /* The trigger creates the profile row; give it a moment on a cold start. */
    for (let i = 0; i < 4; i += 1) {
      await this.loadProfile(data.user.id);
      if (this.profile) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return this.profile;
  }

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error));
    return this.loadProfile(data.user.id);
  }

  async signOut() {
    await this.sb.auth.signOut();
    this.profile = null;
  }

  /**
   * Takes the token out of a password reset link and signs that session in.
   *
   * detectSessionInUrl is off because this app routes on the hash and the SDK
   * doing its own thing with #/fixtures caused more trouble than it solved.
   * The cost is that nothing was reading recovery links either, so the reset
   * email led to the app and then simply sat there. This reads it deliberately
   * and only when the link actually is one.
   */
  async consumeRecoveryLink() {
    const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    if (!raw.includes("access_token")) return false;
    const q = new URLSearchParams(raw);
    if (q.get("type") !== "recovery") return false;
    const access_token = q.get("access_token");
    const refresh_token = q.get("refresh_token");
    if (!access_token || !refresh_token) return false;
    /* setSession throws on a malformed token rather than returning an error,
       so both have to be caught. The hash is cleared in either case: a used or
       expired token in the address bar is worth nothing to anybody and gets
       copied into messages when people ask for help. */
    let failed = null;
    try {
      const { error } = await this.sb.auth.setSession({ access_token, refresh_token });
      if (error) failed = friendly(error);
    } catch (err) {
      failed = friendly(err) || err?.message || "That link did not work.";
    } finally {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (failed) throw new Error(failed);
    return true;
  }

  async setPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(friendly(error));
  }

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.href.split("#")[0],
    });
    if (error) throw new Error(friendly(error));
  }

  /* Badges came after the first release. A database without the column must
     still sign people in, so this degrades to nobody having one rather than
     taking the profile query, and with it the whole login, down with it. */
  /* Email consent rides along here rather than in loadProfile, which must not
     ask for a column that might not exist yet: that query gates sign-in, and
     asking it for a missing column once took every account down with it. This
     one already fails soft. */
  async loadAvatars() {
    /* Narrowed one column at a time rather than straight to the bones. The
       code ships before the schema is run, and a single retry that dropped
       back to four columns took early sight of the consultation results away
       from the people who had been given it, for as long as that gap lasted. */
    const TRIES = [
      "id, avatar, avatar_kit, avatar_pattern, is_admin, tag, email_opt_in, results_viewer, is_moderator",
      "id, avatar, is_admin, tag, email_opt_in, results_viewer, is_moderator",
      "id, avatar, is_admin, tag, email_opt_in, results_viewer",
      "id, avatar, is_admin, tag, email_opt_in",
      "id, avatar, is_admin, tag",
    ];
    for (const cols of TRIES) {
      const { data, error } = await this.sb.from("profiles").select(cols);
      if (!error) return this.shapePeople(data || []);
    }
    return { avatars: {}, kits: {}, patterns: {}, admins: [], tags: {},
             optIn: {}, resultsViewers: [], moderators: [] };
  }

  shapePeople(rows) {
    return {
      avatars: Object.fromEntries(rows.filter((r) => r.avatar).map((r) => [r.id, r.avatar])),
      kits: Object.fromEntries(rows.filter((r) => r.avatar_kit).map((r) => [r.id, r.avatar_kit])),
      patterns: Object.fromEntries(
        rows.filter((r) => r.avatar_pattern).map((r) => [r.id, r.avatar_pattern])),
      admins: rows.filter((r) => r.is_admin).map((r) => r.id),
      tags: Object.fromEntries(rows.filter((r) => r.tag).map((r) => [r.id, r.tag])),
      optIn: Object.fromEntries(rows.map((r) => [r.id, !!r.email_opt_in])),
      resultsViewers: rows.filter((r) => r.results_viewer).map((r) => r.id),
      moderators: rows.filter((r) => r.is_moderator).map((r) => r.id),
    };
  }

  /** Turn emails on or off. The trigger stamps when it changed. */
  async setEmailOptIn(on) {
    const { error } = await this.sb
      .from("profiles").update({ email_opt_in: !!on }).eq("id", this.profile.id);
    if (error) throw new Error(friendly(error));
    this.profile = { ...this.profile, emailOptIn: !!on };
  }

  async setAvatar(emblem) {
    const { error } = await this.sb
      .from("profiles").update({ avatar: emblem }).eq("id", this.profile.id);
    if (error) throw new Error("Badges are not set up in the database yet.");
  }

  /* Colour and pattern together, because they are picked together and two
     round trips to set one look is one too many. Null for either means "go
     back to working it out from the name". */
  async setAvatarStyle(kit, pattern) {
    const { error } = await this.sb
      .from("profiles")
      .update({ avatar_kit: kit || null, avatar_pattern: pattern || null })
      .eq("id", this.profile.id);
    if (error) throw new Error("Kit colours are not set up in the database yet.");
  }

  async rename(displayName) {
    if (!this.profile) throw new Error("Sign in first.");
    const { error } = await this.sb
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", this.profile.id);
    if (error) throw new Error(friendly(error));
    this.profile.name = displayName;
  }

  /* --------------------------------------------------------------- boards */

  async loadBoard(name) {
    const { data, error } = await this.sb
      .from(TABLES[name])
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data.map((row) => fromRow(name, row));
  }

  async addRow(name, row) {
    const { error } = await this.sb.from(TABLES[name]).insert(toRow(name, row, this.profile));
    if (error) throw new Error(friendly(error));
  }

  async updateRow(name, id, patch) {
    const { error } = await this.sb.from(TABLES[name]).update(toPatch(name, patch)).eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  async deleteRow(name, id) {
    const { error } = await this.sb.from(TABLES[name]).delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  /** Redraws every open app when anyone posts. */
  watch(onChange) {
    const channel = this.sb.channel("boards");
    Object.values(TABLES).forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
    });
    ["predictions", "attendance", "pubs", "pub_votes", "poll_votes", "access_reports", "ground_reports"].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
    });
    channel.subscribe();
    return () => this.sb.removeChannel(channel);
  }

  /* ---------------------------------------------------------------- polls */

  async loadPollVotes() {
    const [{ data: results }, { data: mine }] = await Promise.all([
      this.sb.from("poll_results").select("*"),
      this.profile
        ? this.sb.from("poll_votes").select("poll_id, option_index").eq("profile_id", this.profile.id)
        : Promise.resolve({ data: [] }),
    ]);
    return {
      counts: results || [],
      mine: Object.fromEntries((mine || []).map((v) => [v.poll_id, v.option_index])),
    };
  }

  async votePoll(pollId, optionIndex) {
    const { error } = await this.sb.from("poll_votes").insert({
      poll_id: pollId,
      profile_id: this.profile.id,
      option_index: optionIndex,
    });
    if (error) throw new Error(friendly(error));
  }

  /* ---------------------------------------------------------- predictions */

  async loadPredictions() {
    if (!this.profile) return {};
    const { data, error } = await this.sb
      .from("predictions")
      .select("fixture_id, home_score, away_score")
      .eq("profile_id", this.profile.id);
    if (error) throw error;
    return Object.fromEntries(data.map((p) => [p.fixture_id, { home: p.home_score, away: p.away_score }]));
  }

  async savePrediction(fixtureId, home, away) {
    const { error } = await this.sb.from("predictions").upsert(
      {
        profile_id: this.profile.id,
        fixture_id: fixtureId,
        home_score: home,
        away_score: away,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,fixture_id" }
    );
    if (!error) return;

    /* The rule that guards predictions also refuses a fixture it has never
       heard of, so work out which of the two actually happened rather than
       telling somebody a game has kicked off when it has not. */
    if (/row-level security/i.test(error.message)) {
      const { data } = await this.sb
        .from("fixtures")
        .select("kickoff_at")
        .eq("id", fixtureId)
        .maybeSingle();

      if (!data) {
        throw new Error(
          "That fixture has not reached the database yet. Please try again shortly."
        );
      }
      throw new Error("That match has kicked off, so predictions are closed.");
    }

    throw new Error(friendly(error));
  }

  async loadLeague() {
    const { data, error } = await this.sb
      .from("prediction_league")
      .select("*")
      .order("points", { ascending: false })
      .order("exact_scores", { ascending: false });
    if (error) throw error;
    return data;
  }

  /* ----------------------------------------------------------- attendance */

  async loadAttendance() {
    if (!this.profile) return { mine: new Set(), summary: null };
    const [{ data: mine }, { data: summary }] = await Promise.all([
      this.sb.from("attendance").select("fixture_id").eq("profile_id", this.profile.id),
      this.sb.from("attendance_summary").select("*").eq("profile_id", this.profile.id).maybeSingle(),
    ]);
    return { mine: new Set((mine || []).map((r) => r.fixture_id)), summary: summary || null };
  }

  async setAttendance(fixtureId, attended) {
    if (attended) {
      const { error } = await this.sb
        .from("attendance")
        .insert({ profile_id: this.profile.id, fixture_id: fixtureId });
      if (error && error.code !== "23505") throw new Error(friendly(error));
    } else {
      const { error } = await this.sb
        .from("attendance")
        .delete()
        .eq("profile_id", this.profile.id)
        .eq("fixture_id", fixtureId);
      if (error) throw new Error(friendly(error));
    }
  }

  async attendanceTable() {
    const { data, error } = await this.sb
      .from("attendance_summary")
      .select("*")
      .order("games", { ascending: false })
      .order("miles", { ascending: false });
    if (error) throw error;
    return data;
  }

  /* ------------------------------------------------------- player ratings */

  /** Team sheets typed in by a volunteer, keyed by fixture. */
  async loadLineups() {
    const { data, error } = await this.sb.from("lineups").select("fixture_id, players");
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.fixture_id, r.players || []]));
  }

  async saveLineup(fixtureId, players) {
    const { error } = await this.sb.from("lineups").upsert({
      fixture_id: fixtureId,
      players,
      posted_by: this.profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "fixture_id" });
    if (error) throw new Error(friendly(error));
  }

  /** Hand the sheet back to the league's version. Volunteers only, by policy. */
  async deleteLineup(fixtureId) {
    const { error } = await this.sb.from("lineups").delete().eq("fixture_id", fixtureId);
    if (error) throw new Error(friendly(error));
  }

  /**
   * Marks left behind by a correction. Somebody rated a player who turns out
   * not to have been on the pitch, and the row would otherwise keep counting
   * towards his season average for ever.
   */
  async clearRatingsFor(fixtureId, names) {
    if (!names.length) return 0;
    const { error, count } = await this.sb
      .from("player_ratings")
      .delete({ count: "exact" })
      .eq("fixture_id", fixtureId)
      .in("player_name", names);
    if (error) throw new Error(friendly(error));
    return count || 0;
  }

  /** Everyone's averages, plus this supporter's own marks so they can amend. */
  async loadRatings() {
    const [{ data: match }, { data: season }, mine] = await Promise.all([
      this.sb.from("match_ratings").select("*"),
      this.sb.from("season_ratings").select("*").order("average", { ascending: false }),
      this.profile
        ? this.sb.from("player_ratings").select("fixture_id, player_name, rating")
            .eq("profile_id", this.profile.id)
        : Promise.resolve({ data: [] }),
    ]);
    return {
      match: match || [],
      season: season || [],
      mine: Object.fromEntries(
        (mine.data || []).map((r) => [`${r.fixture_id}|${r.player_name}`, r.rating]),
      ),
    };
  }

  async ratePlayer(fixtureId, playerName, rating) {
    const { error } = await this.sb.from("player_ratings").upsert({
      profile_id: this.profile.id,
      fixture_id: fixtureId,
      player_name: playerName,
      rating,
    }, { onConflict: "profile_id,fixture_id,player_name" });
    if (error) throw new Error(friendly(error));
  }

  async clearRating(fixtureId, playerName) {
    const { error } = await this.sb.from("player_ratings").delete()
      .eq("profile_id", this.profile.id)
      .eq("fixture_id", fixtureId)
      .eq("player_name", playerName);
    if (error) throw new Error(friendly(error));
  }

  /** How many supporters have an account. Profiles are readable by anyone. */
  async supporterCount() {
    const { count, error } = await this.sb
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) return null;
    return count ?? null;
  }

  /** Approve or bin a suggested poll. Volunteers only, enforced in the database. */
  async setPollStatus(id, status) {
    const { error } = await this.sb.rpc("set_poll_status", { target: id, new_status: status });
    if (error) throw new Error(friendly(error));
  }

  /* ---------------------------------------------------------- admin panel */

  /** Counts for whoever runs the site. Returns nothing to anyone else. */
  async adminOverview() {
    const { data, error } = await this.sb.from("admin_overview").select("*").maybeSingle();
    if (error) return null;
    return data;
  }

  /** Everyone with an account, newest first, for the people page. */
  /* Who has offered to help with the archive. Volunteers only, enforced in the
     view rather than here: a hidden button is not a control. */
  /** Early sight of the results for one supporter. Volunteers only, in the SQL. */
  async setResultsViewer(profileId, allowed) {
    const { error } = await this.sb.rpc("set_results_viewer", { target: profileId, allowed });
    if (error) throw new Error(friendly(error));
  }

  async archiveOfferList() {
    const { data, error } = await this.sb
      .from("archive_offer_list")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  }

  async adminPeople() {
    const { data, error } = await this.sb
      .from("profiles")
      .select("id, display_name, is_admin, avatar, tag, created_at, email_opt_in, results_viewer, is_moderator, dormant")
      .order("created_at", { ascending: false });
    if (!error) return data || [];
    /* Same reason as loadAvatars: usable before the schema catches up. */
    const retry = await this.sb
      .from("profiles")
      .select("id, display_name, is_admin, avatar, tag, created_at, email_opt_in, results_viewer")
      .order("created_at", { ascending: false });
    return retry.error ? [] : (retry.data || []);
  }

  /* Fire and forget: a streak that fails to record is not worth an error in
     front of somebody mid-game. */
  async recordDuel(streak) {
    try { await this.sb.rpc("record_duel", { p_streak: streak }); } catch { /* never mind */ }
  }

  /* Liking used to be a read, an add and a write back from the browser, which
     lost one of two simultaneous likes and let the same person like the same
     post all afternoon. It also needed a policy that let any signed-in
     supporter update any column of any post. Both are gone: the function owns
     the counter and returns the new total. */
  async likePost(id, on) {
    const { data, error } = await this.sb.rpc("like_post", { p_post: id, p_on: Boolean(on) });
    if (error) throw new Error(friendly(error));
    return typeof data === "number" ? data : null;
  }

  async reportPost(id) {
    try { await this.sb.rpc("report_post", { p_post: id }); } catch { /* flagged is flagged */ }
  }

  /* Which posts this supporter has already liked, so the heart is drawn filled
     in on a device they have never used before. */
  async myLikes() {
    const me = this.profile;
    if (!me) return [];
    const { data, error } = await this.sb
      .from("wall_likes").select("post_id").eq("profile_id", me.id);
    if (error) return [];
    return (data || []).map((r) => r.post_id);
  }

  /* ---- topics ------------------------------------------------------------
     A topic is a row in `topics` plus ordinary wall posts under
     thread = 'topic:<id>'. That is why replies, likes, reporting, hiding and
     the "somebody replied to you" inbox all worked on topics the day they
     landed: none of them ask what kind of thread they are in. */

  async topics() {
    const { data, error } = await this.sb.from("topic_list").select("*");
    if (error) return [];
    return (data || []).map((r) => ({
      id: r.id, authorId: r.profile_id, authorName: r.author_name,
      category: r.category, title: r.title, pinned: r.pinned, locked: r.locked,
      reports: r.reports, createdAt: r.created_at, lastPostAt: r.last_post_at,
      posts: r.posts, lastAuthor: r.last_author,
    }));
  }

  async startTopic(category, title, body) {
    const { data, error } = await this.sb.rpc("start_topic",
      { p_category: category, p_title: title, p_body: body });
    if (error) throw new Error(friendly(error));
    return data;
  }

  async setTopicState(id, field, on) {
    const { error } = await this.sb.rpc("set_topic_state",
      { p_topic: id, p_field: field, p_on: Boolean(on) });
    if (error) throw new Error(friendly(error));
  }

  /* ---- standing ---------------------------------------------------------- */

  async contributorBoard() {
    const { data, error } = await this.sb.from("contributor_board").select("*");
    if (error) return [];
    return data || [];
  }

  async myPoints() {
    const { data, error } = await this.sb.rpc("my_points");
    if (error) return [];
    return (data || []).filter((r) => r.points);
  }

  /* One supporter's public activity, for their profile card. Everything here
     is already on a leaderboard somebody can read, so nothing new is exposed. */
  async supporterSummary(profileId) {
    const [pts, grounds, quiz, duel, wordle, predict] = await Promise.all([
      this.sb.from("supporter_points").select("points").eq("profile_id", profileId).maybeSingle(),
      this.sb.from("ground_visits").select("club_slug").eq("profile_id", profileId),
      this.sb.from("poppies_daily_league").select("*").eq("profile_id", profileId).maybeSingle(),
      this.sb.from("duel_league").select("*").eq("profile_id", profileId).maybeSingle(),
      this.sb.from("wordle_league").select("*").eq("profile_id", profileId).maybeSingle(),
      this.sb.from("prediction_league").select("*"),
    ]);
    /* The view has no order by of its own, so a placement taken from the order
       it happens to return would be a made-up number. */
    const table = (predict.data || []).slice().sort((a, b) =>
      (b.points - a.points) || (b.exact_scores - a.exact_scores) || (a.played - b.played));
    const at = table.findIndex((r) => r.profile_id === profileId);
    return {
      points: pts.data?.points ?? 0,
      grounds: (grounds.data || []).map((r) => r.club_slug),
      quiz: quiz.data || null,
      duel: duel.data || null,
      wordle: wordle.data || null,
      predictPlace: at >= 0 ? at + 1 : null,
      predictOf: table.length,
    };
  }

  async recordWordle(date, len, guesses, solved, marks) {
    try {
      await this.sb.rpc("record_wordle", {
        p_date: date, p_len: len, p_guesses: guesses, p_solved: solved, p_marks: marks });
    } catch { /* a result that fails to record is not worth an error mid-game */ }
  }

  /* ---- points awarded by hand ------------------------------------------- */

  async awardPoints(profileId, reason, points) {
    const me = this.profile;
    const { error } = await this.sb.from("points_credits").insert({
      profile_id: profileId,
      reason: String(reason).trim(),
      points: Math.round(Number(points)),
      awarded_by: me?.id || null,
    });
    if (error) throw new Error(friendly(error));
  }

  async withdrawPoints(id) {
    const { error } = await this.sb.from("points_credits").delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  async pointsCredits(profileId) {
    const { data, error } = await this.sb
      .from("points_credits")
      .select("id, reason, points, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  }

  async setDormant(profileId, hidden) {
    const { error } = await this.sb.rpc("set_dormant",
      { target: profileId, hidden: Boolean(hidden) });
    if (error) throw new Error(friendly(error));
  }

  async groundBoard() {
    const { data, error } = await this.sb.from("ground_board").select("*");
    if (error) return [];
    return data || [];
  }

  async wordleLeague() {
    const { data, error } = await this.sb.from("wordle_league").select("*");
    if (error) return [];
    return data || [];
  }

  async duelLeague() {
    const { data, error } = await this.sb.from("duel_league").select("*");
    if (error) return [];
    return data || [];
  }

  /* Replies to this supporter's posts that they have not seen. The view does
     the filtering from auth.uid(), so there is nothing to pass and nothing to
     ask about anybody else. */
  async unseenReplies() {
    const { data, error } = await this.sb.from("wall_replies_to_me").select("*");
    if (error) return [];
    return data || [];
  }

  async markWallSeen() {
    try { await this.sb.rpc("mark_wall_seen"); } catch { /* not worth an error */ }
  }

  async addParkingReport(clubSlug, r) {
    const me = this.profile;
    const { error } = await this.sb.from("parking_reports").insert({
      club_slug: clubSlug,
      profile_id: me?.id || null,
      author_name: me?.display_name || "A supporter",
      spot: r.spot,
      cost: r.cost ?? null,
      walk_min: r.walkMin ?? null,
      notes: r.notes || null,
      visited_on: r.visitedOn || null,
    });
    if (error) throw new Error(error.message);
  }

  async parkingSummary() {
    const { data, error } = await this.sb.from("parking_summary").select("*");
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.club_slug, r]));
  }

  async parkingReports(clubSlug) {
    const { data, error } = await this.sb
      .from("parking_reports").select("*")
      .eq("club_slug", clubSlug).eq("hidden", false)
      .order("created_at", { ascending: false }).limit(8);
    if (error) return [];
    return data || [];
  }

  async groundVisits() {
    const { data, error } = await this.sb
      .from("ground_visits").select("club_slug, first_seen, note");
    if (error) return [];
    return data || [];
  }

  async setGroundVisit(clubSlug, on, firstSeen) {
    if (!this.profile?.id) return;
    if (!on) {
      const { error } = await this.sb.from("ground_visits").delete()
        .eq("profile_id", this.profile.id).eq("club_slug", clubSlug);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await this.sb.from("ground_visits").upsert({
      profile_id: this.profile.id, club_slug: clubSlug, first_seen: firstSeen || null,
    }, { onConflict: "profile_id,club_slug" });
    if (error) throw new Error(error.message);
  }

  async supporterTags() {
    const { data, error } = await this.sb
      .from("supporter_tags").select("key, label, sort").order("sort");
    if (error) return null;   /* null means "table not there", not "no tags" */
    return data || [];
  }

  async upsertTag(key, label, sort) {
    const { error } = await this.sb.rpc("upsert_tag",
      { p_key: key, p_label: label, p_sort: sort });
    if (error) throw new Error(error.message);
  }

  async deleteTag(key) {
    const { error } = await this.sb.rpc("delete_tag", { p_key: key });
    if (error) throw new Error(error.message);
  }

  async setModerator(profileId, allowed) {
    const { error } = await this.sb.rpc("set_moderator", { target: profileId, allowed });
    if (error) throw new Error(error.message);
  }

  async setTag(profileId, tag) {
    const { error } = await this.sb.rpc("set_user_tag", { target: profileId, new_tag: tag });
    if (error) throw new Error(friendly(error));
  }

  /* --------------------------------------------------------- poppies daily */

  /* Added well after the first release, so a database without the table has to
     fail quietly rather than take the app down with it. Same reason loadPrices
     below returns an empty list: a supporter who cannot see the leaderboard
     should still be able to read the fixtures.

     These read and write raw snake_case rather than going through toRow and
     fromRow. Predictions, attendance and ratings all do the same - that mapper
     only covers the four generic boards. */

  async loadQuizResults() {
    if (!this.profile) return {};
    const { data, error } = await this.sb
      .from("quiz_results")
      .select("quiz_date, score, marks")
      .eq("profile_id", this.profile.id);
    if (error) return {};
    return Object.fromEntries((data || []).map((r) => [r.quiz_date, { score: r.score, marks: r.marks }]));
  }

  /**
   * Records a day. keepExisting is for the guest carry-over, where a result
   * already on the account must win over one brought across from a device.
   */
  async saveQuizResult(quizDate, score, marks, { keepExisting = false } = {}) {
    if (!this.profile) throw new Error("You need to be signed in for that.");
    const { error } = await this.sb
      .from("quiz_results")
      .upsert(
        { profile_id: this.profile.id, quiz_date: quizDate, score, marks },
        { onConflict: "profile_id,quiz_date", ignoreDuplicates: keepExisting }
      );
    if (error) throw new Error(friendly(error));
  }

  async quizLeague() {
    const { data, error } = await this.sb
      .from("poppies_daily_league")
      .select("*")
      .order("streak", { ascending: false })
      .order("points", { ascending: false })
      .order("played", { ascending: false });
    if (error) return [];
    return data || [];
  }

  /* -------------------------------------------------- the archive project */

  /* Offers are private: only the supporter and the volunteers running the
     project can read a row. Everyone sees the counts, which come from a view
     that runs as its owner for exactly that reason. */

  async loadArchiveOffer() {
    if (!this.profile) return null;
    const { data, error } = await this.sb
      .from("archive_offers")
      .select("*")
      .eq("profile_id", this.profile.id)
      .maybeSingle();
    if (error) return null;
    return data;
  }

  async saveArchiveOffer(offer) {
    if (!this.profile) throw new Error("You need to be signed in for that.");
    const { error } = await this.sb.from("archive_offers").upsert(
      {
        profile_id: this.profile.id,
        can_scan: Boolean(offer.canScan),
        has_media: Boolean(offer.hasMedia),
        can_catalogue: Boolean(offer.canCatalogue),
        can_store: Boolean(offer.canStore),
        note: offer.note ? String(offer.note).slice(0, 600) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" }
    );
    if (error) throw new Error(friendly(error));
  }

  async withdrawArchiveOffer() {
    if (!this.profile) return;
    await this.sb.from("archive_offers").delete().eq("profile_id", this.profile.id);
  }

  async archiveCounts() {
    const { data, error } = await this.sb.from("archive_offer_counts").select("*").maybeSingle();
    if (error) return null;
    return data;
  }

  /* ---------------------------------------------------------- consultation */

  /* Answers are readable by volunteers alone. Everyone, signed in or not, sees
     the aggregate views, which run as owner for exactly that reason. */

  async submitConsultation(answer) {
    const row = {
      profile_id: this.profile?.id || null,
      device_key: answer.deviceKey,
      confidence: answer.confidence,
      direction: answer.direction,
      representation: answer.representation || {},
      positives: answer.positives || [],
      concerns: answer.concerns || [],
      actions: answer.actions || [],
      positive_note: answer.positiveNote || null,
      concern_note: answer.concernNote || null,
      question: answer.question || null,
      attribution: answer.attribution || null,
      meeting: answer.meeting || null,
      publish_ok: Boolean(answer.publishOk),
    };
    const { error } = await this.sb.from("consultation_responses").insert(row);
    if (error) {
      /* The unique index on device_key is the duplicate guard. */
      if (error.code === "23505") throw new Error("You have already answered from this device. Thank you.");
      throw new Error(friendly(error));
    }
  }

  /* Whether the findings are on the public page. Read by everyone, because the
     page has to know which of the two closed states to show. */
  async consultationPublished() {
    const { data, error } = await this.sb
      .from("consultation_settings").select("results_public, published_at").maybeSingle();
    if (error) return { results_public: false, published_at: null };
    return data || { results_public: false, published_at: null };
  }

  async setResultsPublic(on) {
    const { error } = await this.sb.rpc("publish_results", { on_now: Boolean(on) });
    if (error) throw new Error(friendly(error));
  }

  /* Merged questions. Volunteers read the table; everybody else reads the view,
     which only shows final groups once the findings are public. */
  async questionGroups() {
    const { data, error } = await this.sb
      .from("consultation_question_groups").select("*").order("sort");
    if (error) return [];
    return data || [];
  }

  async publishedQuestions() {
    const { data, error } = await this.sb
      .from("consultation_questions_public").select("*").order("sort");
    if (error) return [];
    return data || [];
  }

  async saveQuestionGroups(groups) {
    /* Replaced wholesale rather than diffed: the volunteer has just rebuilt the
       whole list in front of them, and a half-applied merge is worse than a
       rewrite. */
    const del = await this.sb.from("consultation_question_groups").delete().neq("id",
      "00000000-0000-0000-0000-000000000000");
    if (del.error) throw new Error(friendly(del.error));
    if (!groups.length) return;
    const { error } = await this.sb.from("consultation_question_groups").insert(
      groups.map((g, i) => ({
        label: g.label, topic: g.topic || null, members: g.members || [],
        sort: i, status: g.status || "draft",
        asked_at: g.asked_at || null, answered_at: g.answered_at || null,
        replied_at: g.replied_at || null, reply_note: g.reply_note || null,
        /* Carried through a rewrite, or a question the working group asked
           would come back as one supporters asked, with a count of nought. */
        origin: g.origin || "supporters",
      })));
    if (error) throw new Error(friendly(error));
  }

  async stampQuestionsAsked() {
    const { error } = await this.sb
      .from("consultation_question_groups")
      .update({ asked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("status", "final").is("asked_at", null);
    if (error) throw new Error(friendly(error));
  }

  async consultationResults() {
    const [summary, confidence, choices, representation, published] = await Promise.all([
      this.sb.from("consultation_summary").select("*").maybeSingle(),
      this.sb.from("consultation_confidence").select("*").order("score"),
      this.sb.from("consultation_choices").select("*").order("people", { ascending: false }),
      this.sb.from("consultation_representation").select("*"),
      this.sb.from("consultation_published").select("*").order("created_at", { ascending: false }),
    ]);
    if (summary.error) return null;
    return {
      summary: summary.data || null,
      confidence: confidence.data || [],
      choices: choices.data || [],
      representation: representation.data || [],
      published: published.data || [],
    };
  }

  /* Fire and forget. A failed count is not worth a retry, still less an error
     in front of somebody reading the page. */
  async recordView(route, isUnique) {
    try {
      await this.sb.rpc("record_view", { p_route: route, p_unique: Boolean(isUnique) });
    } catch { /* counting is never worth interrupting anybody for */ }
  }

  async viewStats(days = 30) {
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { data, error } = await this.sb
      .from("page_views").select("*").gte("day", from).order("day", { ascending: false });
    if (error) return [];
    return data || [];
  }

  /* Volunteers only, gated in the policy rather than here. */
  async consultationQueue() {
    const { data, error } = await this.sb
      .from("consultation_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  }

  async setConsultationStatus(id, patch) {
    const { error } = await this.sb
      .from("consultation_responses")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  async pendingActions() {
    const { data, error } = await this.sb.from("pending_actions").select("*").maybeSingle();
    if (error) return null;
    return data;
  }

  /* -------------------------------------------------------- ticket prices */

  /* Added after the first release, so a database without the table must not
     take anything else down with it. */
  async loadPrices() {
    const { data, error } = await this.sb
      .from("price_reports").select("*").order("created_at", { ascending: false });
    if (error) return [];
    return data || [];
  }

  async addPrice(clubSlug, report) {
    /* A session can lapse while a form is open. Without this the insert throws
       on a null profile and the supporter sees a raw type error. */
    if (!this.profile) throw new Error("Your session has expired. Sign in again and it will save.");
    const { error } = await this.sb.from("price_reports").insert({
      club_slug: clubSlug,
      profile_id: this.profile.id,
      author_name: this.profile.name,
      ...report,
    });
    if (error) throw new Error("That price did not save.");
  }

  /* --------------------------------------------------------- ground notes */

  async loadGround() {
    const { data, error } = await this.sb
      .from("ground_reports").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async addGround(clubSlug, report) {
    const { error } = await this.sb.from("ground_reports").insert({
      club_slug: clubSlug, profile_id: this.profile.id,
      author_name: this.profile.name, ...report,
    });
    if (error) throw new Error(friendly(error));
  }

  async removeGround(id) {
    const { error } = await this.sb.from("ground_reports").delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  /* --------------------------------------------------------------- access */

  async loadAccess() {
    const { data, error } = await this.sb
      .from("access_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async addAccess(clubSlug, report) {
    const { error } = await this.sb.from("access_reports").insert({
      club_slug: clubSlug,
      profile_id: this.profile.id,
      author_name: this.profile.name,
      ...report,
    });
    if (error) throw new Error(friendly(error));
  }

  async removeAccess(id) {
    const { error } = await this.sb.from("access_reports").delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  /* ----------------------------------------------------------------- pubs */

  async loadPubs() {
    const [{ data: pubs, error }, { data: mine }] = await Promise.all([
      this.sb.from("pub_list").select("*").order("votes", { ascending: false }),
      this.profile
        ? this.sb.from("pub_votes").select("pub_id").eq("profile_id", this.profile.id)
        : Promise.resolve({ data: [] }),
    ]);
    if (error) throw error;
    return { pubs: pubs || [], mine: new Set((mine || []).map((v) => v.pub_id)) };
  }

  async addPub(clubSlug, { name, postcode, notes, awayFriendly }) {
    const { error } = await this.sb.from("pubs").insert({
      club_slug: clubSlug,
      profile_id: this.profile.id,
      author_name: this.profile.name,
      name,
      postcode,
      notes,
      away_friendly: awayFriendly || null,
    });
    if (error) throw new Error(friendly(error));
  }

  async removePub(id) {
    const { error } = await this.sb.from("pubs").delete().eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  async hidePub(id, hidden) {
    const { error } = await this.sb.from("pubs").update({ hidden }).eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  /* -------------------------------------------------------------- feedback */

  async sendFeedback({ topic, message, contact }) {
    const { error } = await this.sb.from("feedback").insert({
      profile_id: this.profile?.id || null,
      author_name: this.profile?.name || null,
      topic,
      message,
      contact: contact || null,
    });
    if (error) throw new Error(friendly(error));
  }

  async loadFeedback() {
    const { data, error } = await this.sb
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(friendly(error));
    return data;
  }

  async markFeedback(id, handled) {
    const { error } = await this.sb.from("feedback").update({ handled }).eq("id", id);
    if (error) throw new Error(friendly(error));
  }

  async votePub(id, on) {
    if (on) {
      const { error } = await this.sb
        .from("pub_votes")
        .insert({ pub_id: id, profile_id: this.profile.id });
      if (error && error.code !== "23505") throw new Error(friendly(error));
    } else {
      const { error } = await this.sb
        .from("pub_votes")
        .delete()
        .eq("pub_id", id)
        .eq("profile_id", this.profile.id);
      if (error) throw new Error(friendly(error));
    }
  }
}

/* ------------------------------------------------------------- row shapes */

/* The app works in one shape; Postgres uses snake_case columns. These two
   functions are the only place that difference lives. */

function toRow(name, r, profile) {
  const base = { profile_id: profile?.id, author_name: profile?.name };
  if (name === "coach") {
    return { ...base, fixture_id: r.fixtureId || null, fixture_label: r.fixture,
      fixture_date: r.fixtureDate || null, departs: r.departs, pickup: r.pickup,
      price: r.price, contact: r.contact, notes: r.notes };
  }
  if (name === "lift") {
    return { ...base, kind: r.kind, fixture_id: r.fixtureId || null, fixture_label: r.fixture,
      fixture_date: r.fixtureDate || null, area: r.area, leaving: r.leaving,
      seats: String(r.seats || ""), contact: r.contact, notes: r.notes };
  }
  /* Column names here are the database's, not the app's. Sending replyTo
     instead of reply_to made PostgREST reject every wall post, reply or not,
     and the supporter was told the feature was not switched on. */
  if (name === "wall") return { ...base, text: r.text, thread: r.thread || null, reply_to: r.replyTo || null };
  if (name === "poll") return { ...base, question: r.question, options: r.options.map((o) => o.label), status: r.status || "pending" };
  return base;
}

function toPatch(name, patch) {
  const map = { fixture: "fixture_label", fixtureDate: "fixture_date", fixtureId: "fixture_id" };
  const out = {};
  Object.entries(patch).forEach(([k, v]) => {
    if (k === "options") out.options = v.map((o) => o.label);
    else out[map[k] || k] = v;
  });
  return out;
}

function fromRow(name, row) {
  const base = {
    id: row.id,
    createdAt: new Date(row.created_at).getTime(),
    authorId: row.profile_id,
    authorName: row.author_name,
  };
  if (name === "coach") {
    return { ...base, fixture: row.fixture_label, fixtureId: row.fixture_id,
      fixtureDate: row.fixture_date, departs: row.departs, pickup: row.pickup,
      price: row.price, contact: row.contact, notes: row.notes };
  }
  if (name === "lift") {
    return { ...base, kind: row.kind, fixture: row.fixture_label, fixtureId: row.fixture_id,
      fixtureDate: row.fixture_date, area: row.area, leaving: row.leaving,
      seats: row.seats, contact: row.contact, notes: row.notes };
  }
  if (name === "wall") {
    return { ...base, text: row.text, thread: row.thread || null,
      replyTo: row.reply_to || null,
      likes: row.likes, reports: row.reports, hidden: row.hidden };
  }
  if (name === "poll") {
    return { ...base, question: row.question, closed: row.closed,
      status: row.status || "live",
      options: (row.options || []).map((label) => ({ label, votes: 0 })) };
  }
  return base;
}

/* Postgres errors are not written for supporters. */
function friendly(error) {
  const m = String(error?.message || "");
  /* PostgREST puts the useful part in a code, not the sentence. Matching the
     wording alone missed both cases the first time this was written. */
  const code = String(error?.code || "");
  if (/Invalid login credentials/i.test(m)) return "That email address or password was not recognised.";
  if (/User already registered/i.test(m)) return "There is already an account with that email address.";
  if (/Password should be/i.test(m)) return "Please use a password of at least six characters.";
  if (/valid email/i.test(m)) return "Please check the email address.";
  if (/row-level security/i.test(m)) return "You do not have permission to do that.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
  if (/duplicate key/i.test(m)) return "That has already been added.";
  /* A missing table really does mean the latest schema.sql has not been run.
     Raw Postgres wording helps nobody standing in a car park. */
  if (code === "PGRST205" || /Could not find the table/i.test(m) || /relation .* does not exist/i.test(m)) {
    return "That part of the app is not switched on yet. Please let the KTFCSA team know.";
  }

  /* A missing column is different: the table is there, so the schema is fine
     and the app has asked for a field that does not exist. That is our
     mistake, and saying "not switched on yet" sends people looking for a
     migration that has already run. It cost us two rounds of bug reports on
     the fan wall, so it is worth being honest and loud about it. */
  if (code === "PGRST204" || /Could not find the .* column/i.test(m) || /column .* does not exist/i.test(m)) {
    console.error("Field name mismatch between the app and the database:", m);
    return "Something in the app is out of step with the database. That is a fault our end, not yours.";
  }
  if (/Failed to fetch|NetworkError/i.test(m)) return "No connection. Please try again.";
  return m || "Something went wrong. Please try again.";
}
