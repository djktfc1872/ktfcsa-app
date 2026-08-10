/* Supabase driver.

   Loaded only when config.js has a project URL. Everything it exposes is
   promise based; store.js keeps a synchronous cache on top so the views can
   still render in one pass. */

import { CONFIG } from "./config.js";

const SDK = "https://esm.sh/@supabase/supabase-js@2.45.4";

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

  async signUp(email, password, displayName) {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw new Error(friendly(error));
    if (!data.session) {
      throw new Error("Check your inbox to confirm your address, then sign in.");
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

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.href.split("#")[0],
    });
    if (error) throw new Error(friendly(error));
  }

  /* Badges came after the first release. A database without the column must
     still sign people in, so this degrades to nobody having one rather than
     taking the profile query, and with it the whole login, down with it. */
  async loadAvatars() {
    const { data, error } = await this.sb.from("profiles").select("id, avatar, is_admin");
    if (error) return { avatars: {}, admins: [] };
    const rows = data || [];
    return {
      avatars: Object.fromEntries(rows.filter((r) => r.avatar).map((r) => [r.id, r.avatar])),
      admins: rows.filter((r) => r.is_admin).map((r) => r.id),
    };
  }

  async setAvatar(emblem) {
    const { error } = await this.sb
      .from("profiles").update({ avatar: emblem }).eq("id", this.profile.id);
    if (error) throw new Error("Badges are not set up in the database yet.");
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

  async addPub(clubSlug, { name, postcode, notes }) {
    const { error } = await this.sb.from("pubs").insert({
      club_slug: clubSlug,
      profile_id: this.profile.id,
      author_name: this.profile.name,
      name,
      postcode,
      notes,
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
  if (name === "poll") return { ...base, question: r.question, options: r.options.map((o) => o.label) };
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
      options: (row.options || []).map((label) => ({ label, votes: 0 })) };
  }
  return base;
}

/* Postgres errors are not written for supporters. */
function friendly(error) {
  const m = String(error?.message || "");
  if (/Invalid login credentials/i.test(m)) return "That email address or password was not recognised.";
  if (/User already registered/i.test(m)) return "There is already an account with that email address.";
  if (/Password should be/i.test(m)) return "Please use a password of at least six characters.";
  if (/valid email/i.test(m)) return "Please check the email address.";
  if (/row-level security/i.test(m)) return "You do not have permission to do that.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
  if (/duplicate key/i.test(m)) return "That has already been added.";
  /* Shows up when the database has not had the latest schema.sql run against
     it. Raw Postgres wording helps nobody standing in a car park. */
  if (/schema cache|does not exist|PGRST205/i.test(m)) {
    return "That part of the app is not switched on yet. Please let the KTFCSA team know.";
  }
  if (/Failed to fetch|NetworkError/i.test(m)) return "No connection. Please try again.";
  return m || "Something went wrong. Please try again.";
}
