/* Accounts, saved data and post checks.

   With Supabase configured, supporters have real accounts that follow them
   between devices, and predictions, attendance and the boards are shared.
   Without it, the app still runs on one device with a nickname, so nothing is
   ever a blank screen.

   Reads stay synchronous so views render in one pass. Writes are optimistic:
   the cache updates immediately and the backend catches up. */

import { CONFIG, BLOCKED_WORDS, SPAM_PATTERNS } from "./config.js";

const PREFIX = "ktfcsa:";
const BOARDS = ["coach", "lift", "poll", "wall"];

/* ------------------------------------------------------------------ basics */

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing sensible to do if storage is blocked */
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

/* ------------------------------------------------------------------- state */

const cache = Object.fromEntries(BOARDS.map((b) => [b, []]));

let backend = null; // the Supabase driver, or null when running locally
let onChange = () => {};
let onError = () => {};

/** Extra state that only exists when signed in to Supabase. */
const live = {
  predictions: {},          // fixtureId -> {home, away}
  attendance: new Set(),    // fixtureIds
  attendanceSummary: null,
  pollVotes: {},            // pollId -> option index
  pubs: [],
  pubVotes: new Set(),
  access: [],
  ground: [],
  prices: [],               // what supporters say they actually paid
  avatars: {},              // profileId -> emblem key
  kits: {},                 // profileId -> chosen avatar colour, #rrggbb
  patterns: {},             // profileId -> chosen avatar pattern
  admins: new Set(),        // profileIds of KTFCSA volunteers
  tags: {},                 // profileId -> a tag a volunteer handed out
  supporters: null,         // how many accounts there are, for the join prompts
  optIn: {},                // profileId -> whether they agreed to emails
  lineups: {},              // fixtureId -> [{name, number, started}] typed in by a volunteer
  ratings: { match: [], season: [], mine: {} },
  resultsViewers: new Set(),  // early, read-only sight of the consultation results
  moderators: new Set(),      // can moderate what supporters write, but not change structure
  groundVisits: new Set(),    // club slugs whose ground this supporter has been to
  quiz: {},                 // "2026-08-22" -> {score, marks} for the signed-in supporter
};

export const isOnline = () => Boolean(backend);
export const mode = () => (backend ? "supabase" : "local");

/* ----------------------------------------------------------- local account */

function localUser() {
  const u = read("user", null);
  if (!u) return null;
  if ((Date.now() - (u.signedInAt || 0)) / 86400000 > CONFIG.sessionDays) {
    remove("user");
    return null;
  }
  return u;
}

const initialsOf = (name) =>
  String(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/** The signed-in supporter, whichever backend they came from. */
export function currentUser() {
  if (backend) {
    const p = backend.profile;
    return p ? { ...p, initials: initialsOf(p.name) } : null;
  }
  const u = localUser();
  return u ? { ...u, initials: initialsOf(u.name) } : null;
}

export const isAdmin = () => Boolean(currentUser()?.isAdmin);

/* A moderator deals with what supporters write. An admin can do everything a
   moderator can, so this is true for them too: anywhere that asks "may this
   person moderate" should ask this rather than isAdmin(). */
export const isModerator = () => {
  const u = currentUser();
  return Boolean(u && (u.isAdmin || live.moderators.has(u.id)));
};
export const isModeratorId = (id) => live.moderators.has(id);

/* True when the page was opened from a password reset link, in which case the
   session is now live and the person needs to choose a new password. */
export const consumeRecoveryLink = () =>
  (backend?.consumeRecoveryLink ? backend.consumeRecoveryLink() : Promise.resolve(false));

export async function setPassword(password) {
  if (!backend) throw new Error("Not connected.");
  await backend.setPassword(password);
}

export const recordDuel = (streak) =>
  (backend?.recordDuel ? backend.recordDuel(streak) : Promise.resolve());
export const duelLeague = () =>
  (backend?.duelLeague ? backend.duelLeague() : Promise.resolve([]));

export const likePost = (id, on) =>
  (backend?.likePost ? backend.likePost(id, on) : Promise.resolve(null));
export const reportPost = (id) =>
  (backend?.reportPost ? backend.reportPost(id) : Promise.resolve());
export const myLikes = () =>
  (backend?.myLikes ? backend.myLikes() : Promise.resolve([]));

export const topics = () =>
  (backend?.topics ? backend.topics() : Promise.resolve([]));
export const startTopic = (category, title, body) =>
  (backend?.startTopic ? backend.startTopic(category, title, body)
    : Promise.reject(new Error("Sign in to start a topic")));
export const setTopicState = (id, field, on) =>
  (backend?.setTopicState ? backend.setTopicState(id, field, on) : Promise.resolve());

export const contributorBoard = () =>
  (backend?.contributorBoard ? backend.contributorBoard() : Promise.resolve([]));
export const myPoints = () =>
  (backend?.myPoints ? backend.myPoints() : Promise.resolve([]));
export const supporterSummary = (id) =>
  (backend?.supporterSummary ? backend.supporterSummary(id) : Promise.resolve(null));

export const recordWordle = (d, len, g, solved, marks) =>
  (backend?.recordWordle ? backend.recordWordle(d, len, g, solved, marks) : Promise.resolve());
export const awardPoints = (id, reason, pts) =>
  (backend?.awardPoints ? backend.awardPoints(id, reason, pts)
    : Promise.reject(new Error("Not connected.")));
export const withdrawPoints = (id) =>
  (backend?.withdrawPoints ? backend.withdrawPoints(id) : Promise.resolve());
export const pointsCredits = (id) =>
  (backend?.pointsCredits ? backend.pointsCredits(id) : Promise.resolve([]));
export const setDormant = (id, hidden) =>
  (backend?.setDormant ? backend.setDormant(id, hidden)
    : Promise.reject(new Error("Not connected.")));

export const exactCalls = () =>
  (backend?.exactCalls ? backend.exactCalls() : Promise.resolve([]));
export const meetings = () =>
  (backend?.meetings ? backend.meetings() : Promise.resolve([]));
export const rsvpMeeting = (id, coming, key, name, email, eating) =>
  (backend?.rsvpMeeting ? backend.rsvpMeeting(id, coming, key, name, email, eating)
    : Promise.reject(new Error("Not connected.")));
export const meetingList = (id) =>
  (backend?.meetingList ? backend.meetingList(id) : Promise.resolve([]));

export const groundBoard = () =>
  (backend?.groundBoard ? backend.groundBoard() : Promise.resolve([]));
export const wordleLeague = () =>
  (backend?.wordleLeague ? backend.wordleLeague() : Promise.resolve([]));

export const unseenReplies = () =>
  (backend?.unseenReplies ? backend.unseenReplies() : Promise.resolve([]));
export const markWallSeen = () =>
  (backend?.markWallSeen ? backend.markWallSeen() : Promise.resolve());

export const parkingSummary = () =>
  (backend?.parkingSummary ? backend.parkingSummary() : Promise.resolve({}));
export const parkingReports = (slug) =>
  (backend?.parkingReports ? backend.parkingReports(slug) : Promise.resolve([]));
export function addParkingReport(slug, report) {
  if (!backend) return Promise.resolve();
  return attempt(backend.addParkingReport(slug, report).then(refresh),
    "That did not save.");
}

/* Grounds ticked off, kept in one place so a page can ask without a round trip.
   Attendance covers this season on its own; this is everything before it. */
export const groundVisits = () => live.groundVisits;
export async function loadGroundVisits() {
  if (!backend || !currentUser()) { live.groundVisits = new Set(); return; }
  const rows = await backend.groundVisits().catch(() => []);
  live.groundVisits = new Set(rows.map((r) => r.club_slug));
}
export async function setGroundVisit(clubSlug, on, firstSeen) {
  if (!backend) return;
  if (on) live.groundVisits.add(clubSlug);
  else live.groundVisits.delete(clubSlug);
  onChange();
  await attempt(backend.setGroundVisit(clubSlug, on, firstSeen), "That did not save.");
}

export const supporterTags = () =>
  (backend?.supporterTags ? backend.supporterTags() : Promise.resolve(null));
export const upsertTag = (key, label, sort) => backend.upsertTag(key, label, sort);
export const deleteTag = (key) => backend.deleteTag(key);

export async function setModerator(profileId, allowed) {
  if (!backend) return;
  await backend.setModerator(profileId, allowed);
  await refresh();
}

/* ------------------------------------------------------------------- setup */

export async function initStore({ change = () => {}, error = () => {} } = {}) {
  onChange = change;
  onError = error;

  if (CONFIG.supabase?.url && CONFIG.supabase?.anonKey) {
    try {
      const { connect } = await import("./supabase.js");
      backend = await connect();
      await backend.restore();
      backend.watch(() => refresh());
      await refresh();
      return "supabase";
    } catch (err) {
      backend = null;
      onError("Could not reach the account service, so the app is running on this device only.");
      console.warn("Supabase unavailable, falling back to local:", err);
    }
  }

  BOARDS.forEach((b) => {
    cache[b] = read(`c:${b}`, []);
  });
  return "local";
}

/** Pulls everything the signed-in supporter can see. */
export async function refresh() {
  if (!backend) return;
  try {
    const boards = await Promise.all(BOARDS.map((b) => backend.loadBoard(b)));
    BOARDS.forEach((b, i) => {
      cache[b] = boards[i];
    });

    const { counts, mine } = await backend.loadPollVotes();
    live.pollVotes = mine;
    cache.poll = cache.poll.map((p) => ({
      ...p,
      options: p.options.map((o, i) => ({
        ...o,
        votes: counts.find((c) => c.poll_id === p.id && c.option_index === i)?.votes || 0,
      })),
    }));

    if (backend.profile) {
      const [predictions, attendance, pubs] = await Promise.all([
        backend.loadPredictions(),
        backend.loadAttendance(),
        backend.loadPubs(),
      ]);
      live.predictions = predictions;
      live.attendance = attendance.mine;
      live.attendanceSummary = attendance.summary;
      live.pubs = pubs.pubs;
      live.pubVotes = pubs.mine;
    } else {
      const pubs = await backend.loadPubs();
      live.pubs = pubs.pubs;
    }

    live.access = await backend.loadAccess();
    live.ground = await backend.loadGround();
    live.prices = await backend.loadPrices();
    /* Ratings arrived after the first release, so a database that has not had
       the newer tables added yet must not stop everything else refreshing. */
    try {
      const people = await backend.loadAvatars();
    live.avatars = people.avatars;
    live.kits = people.kits || {};
    live.patterns = people.patterns || {};
    live.admins = new Set(people.admins);
    live.tags = people.tags || {};
    live.optIn = people.optIn || {};
    live.resultsViewers = new Set(people.resultsViewers || []);
    live.moderators = new Set(people.moderators || []);
    loadGroundVisits();   /* the ticked list, once there is somebody to ask about */
    live.supporters = await backend.supporterCount();
    live.lineups = await backend.loadLineups();
      live.ratings = await backend.loadRatings();
    } catch (err) {
      console.warn("Player ratings are not set up in the database yet:", err?.message || err);
    }
    /* Later again than the ratings, and the same rule applies. */
    try {
      live.quiz = await backend.loadQuizResults();
    } catch (err) {
      console.warn("Poppies Daily is not set up in the database yet:", err?.message || err);
    }
    onChange();
  } catch (err) {
    console.warn("Refresh failed:", err);
  }
}

function attempt(promise, fallbackMessage) {
  return Promise.resolve(promise).catch((err) => {
    onError(err?.message || fallbackMessage);
    console.warn(fallbackMessage, err);
  });
}

/* ---------------------------------------------------------------- accounts */

export async function signUp(email, password, displayName, options = {}) {
  const name = String(displayName || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) throw new Error("Please enter a name of at least two characters.");
  if (!backend) return signInLocal(name);
  const profile = await backend.signUp(email.trim(), password, name);
  await adoptGuestPredictions();
  await adoptGuestQuiz();
  await refresh();
  return profile;
}

export async function signIn(email, password) {
  if (!backend) return signInLocal(email);
  const profile = await backend.signIn(String(email).trim(), password);
  await adoptGuestPredictions();
  await adoptGuestQuiz();
  await refresh();
  return profile;
}

export async function signOut() {
  if (backend) {
    await backend.signOut();
    live.predictions = {};
    live.attendance = new Set();
    live.attendanceSummary = null;
    live.groundVisits = new Set();
    live.pollVotes = {};
    live.pubVotes = new Set();
    await refresh();
    return;
  }
  remove("user");
}

export async function resetPassword(email) {
  if (!backend) throw new Error("Password resets need the online version.");
  return backend.resetPassword(String(email).trim());
}

export async function rename(displayName) {
  const name = String(displayName || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) throw new Error("Please enter a name of at least two characters.");
  if (!backend) {
    const u = localUser();
    if (u) write("user", { ...u, name });
    return;
  }
  await backend.rename(name);
  onChange();
}

/** Only used when there is no Supabase project configured. */
function signInLocal(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (clean.length < 2) throw new Error("Please enter a name of at least two characters.");
  const existing = read("user", null);
  const user = {
    id: existing?.id || uid(),
    name: clean,
    isAdmin: existing?.isAdmin || false,
    signedInAt: Date.now(),
  };
  write("user", user);
  return user;
}

/** Local-only admin unlock. With Supabase, is_admin is set in the dashboard. */
export function unlockLocalAdmin(passcode) {
  if (backend) {
    throw new Error("Volunteer access is granted from the Supabase dashboard, not with a passcode.");
  }
  const u = localUser();
  if (!u) throw new Error("Sign in first.");
  if (String(passcode || "").trim() !== CONFIG.localAdminPasscode) {
    throw new Error("That passcode was not recognised.");
  }
  write("user", { ...u, isAdmin: true });
}

export function lockLocalAdmin() {
  const u = localUser();
  if (u) write("user", { ...u, isAdmin: false });
}

/* ------------------------------------------------------------ post checking */

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", $: "s", "@": "a", "!": "i" };

function flatten(text) {
  return String(text)
    .toLowerCase()
    .replace(/[013457 8$@!]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, "");
}

export function checkPost(text, { maxLength = 600, minLength = 2 } = {}) {
  const raw = String(text || "").trim();

  if (raw.length < minLength) return { ok: false, reason: "Write a little more before posting." };
  if (raw.length > maxLength) {
    return { ok: false, reason: `Keep it under ${maxLength} characters. Yours is ${raw.length}.` };
  }

  const squashed = flatten(raw);
  if (BLOCKED_WORDS.some((w) => squashed.includes(flatten(w)))) {
    return { ok: false, reason: "That wording will not post. Please keep it civil." };
  }

  if (SPAM_PATTERNS.some((re) => re.test(raw))) {
    return { ok: false, reason: "That looks like spam, so it has not been posted." };
  }

  const letters = raw.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 12) {
    const caps = letters.replace(/[^A-Z]/g, "").length / letters.length;
    if (caps > 0.7) return { ok: false, reason: "Please turn off caps lock." };
  }

  if (/(.)\1{9,}/.test(raw)) return { ok: false, reason: "Please remove the repeated characters." };

  if ((raw.match(/https?:\/\/\S+/g) || []).length > 2) {
    return { ok: false, reason: "Please include no more than two links." };
  }

  return { ok: true, reason: "" };
}

export function rateLimit(bucket, { max = 5, windowMs = 60000 } = {}) {
  const key = `rate:${bucket}`;
  const now = Date.now();
  const hits = read(key, []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const wait = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return { ok: false, reason: `Please wait ${wait} seconds before posting again.` };
  }
  hits.push(now);
  write(key, hits);
  return { ok: true, reason: "" };
}

/* ------------------------------------------------------------------ boards */

export const list = (name) => cache[name] || [];

export function add(name, item) {
  const user = currentUser();
  const row = {
    id: uid(),
    createdAt: Date.now(),
    authorId: user?.id || "anon",
    authorName: user?.name || "Anonymous",
    ...item,
  };
  cache[name] = [row, ...list(name)];
  if (backend) attempt(backend.addRow(name, item).then(refresh), "That post did not save.");
  else write(`c:${name}`, cache[name]);
  return row;
}

export function update(name, id, patch) {
  cache[name] = list(name).map((r) => (r.id === id ? { ...r, ...patch } : r));
  if (backend) attempt(backend.updateRow(name, id, patch), "That change did not save.");
  else write(`c:${name}`, cache[name]);
  return cache[name];
}

/**
 * Change a row in the local copy only.
 *
 * Used where the database is the one keeping score and the browser is only
 * showing what it expects to happen. Liking is the case that matters: the
 * counter belongs to like_post(), and a supporter has no right to write to
 * somebody else's post, so sending this to the server would be a no-op at best.
 */
export function patchLocal(name, id, patch) {
  cache[name] = list(name).map((r) => (r.id === id ? { ...r, ...patch } : r));
  return cache[name];
}

export function drop(name, id) {
  cache[name] = list(name).filter((r) => r.id !== id);
  if (backend) attempt(backend.deleteRow(name, id), "That deletion did not save.");
  else write(`c:${name}`, cache[name]);
  return cache[name];
}

export function clearAll() {
  BOARDS.forEach((name) => {
    const rows = list(name);
    cache[name] = [];
    if (backend) rows.forEach((r) => attempt(backend.deleteRow(name, r.id), "That deletion did not save."));
    else write(`c:${name}`, []);
  });
}

export function canEdit(row) {
  const user = currentUser();
  if (!user) return false;
  return user.isAdmin || row.authorId === user.id;
}

/* ------------------------------------------------------------------ voting */

export const myVote = (pollId) =>
  backend ? live.pollVotes[pollId] ?? null : read(`vote:${pollId}`, null);

export function castVote(pollId, optionIndex) {
  if (myVote(pollId) !== null) return;

  const poll = cache.poll.find((p) => p.id === pollId);
  if (poll) {
    poll.options = poll.options.map((o, i) => (i === optionIndex ? { ...o, votes: o.votes + 1 } : o));
  }

  if (backend) {
    live.pollVotes[pollId] = optionIndex;
    attempt(backend.votePoll(pollId, optionIndex), "Your vote did not save.");
  } else {
    write(`vote:${pollId}`, optionIndex);
    write("c:poll", cache.poll);
  }
}

/* ------------------------------------------------------------- predictions */

/* Anyone can predict. Without an account the guesses live on the device, and
   they are carried over the moment somebody joins, so having a go first never
   costs them anything. Only the leaderboard needs an account. */

const guestPredictions = () => read("guest:predictions", {});

export function myPrediction(fixtureId) {
  const signedIn = Boolean(currentUser());
  if (backend && signedIn) return live.predictions[fixtureId] || null;
  return guestPredictions()[fixtureId] || null;
}

export function savePrediction(fixtureId, home, away) {
  const signedIn = Boolean(currentUser());

  if (!backend || !signedIn) {
    write("guest:predictions", { ...guestPredictions(), [fixtureId]: { home, away } });
    onChange();
    return;
  }

  live.predictions[fixtureId] = { home, away };
  onChange();
  attempt(backend.savePrediction(fixtureId, home, away).then(refresh), "Your prediction did not save.");
}

/**
 * Moves predictions made before signing up onto the new account. Anything that
 * has already kicked off is refused by the database, which is what we want, so
 * failures here are ignored rather than shown.
 */
async function adoptGuestPredictions() {
  if (!backend?.profile) return;
  const guesses = Object.entries(guestPredictions());
  if (!guesses.length) return;

  let moved = 0;
  for (const [fixtureId, p] of guesses) {
    try {
      await backend.savePrediction(fixtureId, p.home, p.away);
      moved += 1;
    } catch {
      /* closed fixture, or one the feed no longer lists */
    }
  }
  remove("guest:predictions");
  if (moved) onError(`Brought ${moved} prediction${moved === 1 ? "" : "s"} across to your account.`);
}

export const predictionLeague = () => (backend ? backend.loadLeague() : Promise.resolve([]));

/* ----------------------------------------------------------- poppies daily */

/* Same bargain as the predictions above: play first, join later. The one
   difference is that a day is written to the device even when signed in.
   People finish the quiz on a train with one bar of signal, and a result that
   failed to send is worth keeping until the next refresh can retry it. */

const guestQuiz = () => read("guest:quiz", {});

/** Every day this device or account knows about, the server winning ties. */
export function quizHistory() {
  return { ...guestQuiz(), ...(currentUser() ? live.quiz : {}) };
}

export const quizResultFor = (date) => quizHistory()[date] || null;

export function saveQuizResult(date, score, marks) {
  write("guest:quiz", { ...guestQuiz(), [date]: { score, marks } });
  if (backend && currentUser()) {
    live.quiz = { ...live.quiz, [date]: { score, marks } };
    attempt(backend.saveQuizResult(date, score, marks), "Your Poppies Daily did not save.");
  }
  onChange();
}

/**
 * Consecutive days ending today or yesterday. Yesterday still counts: somebody
 * who has not played yet this morning has not lost their streak. Mirrors the
 * poppies_daily_league view so the number on the page and the number on the
 * leaderboard agree.
 */
export function quizStreak(today) {
  const days = quizHistory();
  const step = (iso, back) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
  };
  let from = days[today] ? today : step(today, 1);
  if (!days[from]) return 0;
  let n = 0;
  while (days[from]) { n += 1; from = step(from, 1); }
  return n;
}

export const quizLeague = () => (backend ? backend.quizLeague() : Promise.resolve([]));

/* ------------------------------------------------------------- consultation */

/* A random string, kept on the device so somebody is not asked twice. It is
   not derived from anything about them and is never shown or published. */
export function consultDeviceKey() {
  let k = read("consult:key", null);
  if (!k) {
    k = (crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "");
    write("consult:key", k);
  }
  return k;
}

export const hasAnswered = () => Boolean(read("consult:done", null));

export async function submitConsultation(answer) {
  if (!backend) throw new Error("The consultation is not available offline.");
  await backend.submitConsultation({ ...answer, deviceKey: consultDeviceKey() });
  /* Remembered locally as well as in the database, because an anonymous
     supporter has no other way of being recognised on their next visit. */
  write("consult:done", new Date().toISOString());
  onChange();
}

export const consultationResults = () => (backend ? backend.consultationResults() : Promise.resolve(null));
export const consultationPublished = () =>
  (backend ? backend.consultationPublished() : Promise.resolve({ results_public: false }));
/**
 * Counts a page view.
 *
 * The only thing that decides "unique" is a date in this browser's own storage,
 * so no identifier is ever sent and there is nothing on the server that could
 * be traced back to anybody. Clearing storage or opening a second browser
 * counts twice, which makes uniques a floor rather than a truth, and that is
 * the right way round for a number nobody should be able to weaponise.
 */
const SEEN_KEY = "seen-day";
export function recordView(route) {
  if (!backend) return;
  const today = new Date().toISOString().slice(0, 10);
  let first = false;
  try {
    first = read(SEEN_KEY) !== today;
    if (first) write(SEEN_KEY, today);
  } catch { /* private mode, or storage full: it just counts as a return visit */ }
  backend.recordView(route, first);
}

export const viewStats = (days) => (backend ? backend.viewStats(days) : Promise.resolve([]));

export const questionGroups = () => (backend ? backend.questionGroups() : Promise.resolve([]));
export const publishedQuestions = () => (backend ? backend.publishedQuestions() : Promise.resolve([]));

export async function setResultsPublic(on) {
  if (!backend) return;
  await backend.setResultsPublic(on);
  onChange();
}
export async function saveQuestionGroups(groups) {
  if (!backend) return;
  await backend.saveQuestionGroups(groups);
  onChange();
}
export async function stampQuestionsAsked() {
  if (!backend) return;
  await backend.stampQuestionsAsked();
  onChange();
}
export const consultationQueue = () => (backend ? backend.consultationQueue() : Promise.resolve([]));
export const pendingActions = () => (backend ? backend.pendingActions() : Promise.resolve(null));

export async function setConsultationStatus(id, patch) {
  if (!backend) return;
  await backend.setConsultationStatus(id, patch);
  onChange();
}

/* ------------------------------------------------------- archive project */

/* Nothing here is cached in `live`: the page is visited rarely and an offer is
   changed even more rarely, so it is fetched when the page opens. */

export const archiveOffer = () => (backend?.profile ? backend.loadArchiveOffer() : Promise.resolve(null));
export const archiveCounts = () => (backend ? backend.archiveCounts() : Promise.resolve(null));

export async function saveArchiveOffer(offer) {
  if (!backend?.profile) throw new Error("You need to be signed in for that.");
  await backend.saveArchiveOffer(offer);
  onChange();
}

export async function withdrawArchiveOffer() {
  if (!backend?.profile) return;
  await backend.withdrawArchiveOffer();
  onChange();
}

/**
 * Moves days played before joining onto the new account. The database refuses
 * anything older than its sixty-day window, which is what we want, so failures
 * here are ignored rather than shown. A day the account already has wins.
 */
async function adoptGuestQuiz() {
  if (!backend?.profile) return;
  const days = Object.entries(guestQuiz());
  if (!days.length) return;

  let moved = 0;
  for (const [date, r] of days) {
    try {
      await backend.saveQuizResult(date, r.score, r.marks, { keepExisting: true });
      moved += 1;
    } catch {
      /* outside the window, or already recorded on the account */
    }
  }
  remove("guest:quiz");
  if (moved) onError(`Brought ${moved} day${moved === 1 ? "" : "s"} of Poppies Daily across to your account.`);
}

/* -------------------------------------------------------------- attendance */

export const didAttend = (fixtureId) => live.attendance.has(fixtureId);
export const attendanceSummary = () => live.attendanceSummary;

export function setAttendance(fixtureId, attended) {
  if (!backend) {
    onError("Attendance tracking needs an account. Ask your fellow volunteers to finish the online setup.");
    return;
  }
  if (attended) live.attendance.add(fixtureId);
  else live.attendance.delete(fixtureId);
  onChange();
  attempt(backend.setAttendance(fixtureId, attended).then(refresh), "That did not save.");
}

export const attendanceTable = () => (backend ? backend.attendanceTable() : Promise.resolve([]));

/* ---------------------------------------------------------- ground notes */

export const groundFor = (clubSlug) =>
  live.ground.filter((r) => r.club_slug === clubSlug && !r.hidden);

export function addGroundReport(clubSlug, report) {
  if (!backend) {
    onError("Ground notes need an account. Ask your fellow volunteers to finish the online setup.");
    return;
  }
  attempt(backend.addGround(clubSlug, report).then(refresh), "That note did not save.");
}

export function removeGroundReport(id) {
  live.ground = live.ground.filter((r) => r.id !== id);
  onChange();
  attempt(backend.removeGround(id).then(refresh), "That deletion did not save.");
}

/* --------------------------------------------------------- ticket prices */

export const pricesFor = (clubSlug) =>
  live.prices.filter((r) => r.club_slug === clubSlug && !r.hidden);

export function addPriceReport(clubSlug, report) {
  if (!backend) {
    onError("Price reports need an account.");
    return;
  }
  attempt(backend.addPrice(clubSlug, report).then(refresh), "That price did not save.");
}

/* ---------------------------------------------------------------- emblems */

/** The badge a supporter picked, or null if they are still on their initials. */
export const avatarOf = (profileId) => live.avatars[profileId] || null;
/* Null from either of these means the avatar is still worked out from the
   name, which is what everybody has until they open the picker. */
export const kitOf = (profileId) => (live.kits || {})[profileId] || null;
export const patternOf = (profileId) => (live.patterns || {})[profileId] || null;

/** True when a profile belongs to a KTFCSA volunteer, so posts can say so. */
export const isVolunteer = (profileId) => live.admins.has(profileId);

/* Anyone who has filed a ground note, an access report or suggested a pub.
   Worked out from rows the app has already loaded, so it costs no extra query
   and no extra column. */
/** A tag handed out by a volunteer, which beats anything worked out from rows. */
export const tagOf = (profileId) => live.tags[profileId] || null;

/** Approve or bin a suggested poll. */
export function setPollStatus(id, status) {
  if (!backend) return;
  const row = (cache.poll || []).find((p) => p.id === id);
  if (row) row.status = status;
  onChange();
  attempt(backend.setPollStatus(id, status).then(refresh), "That did not save.");
}

/** How many supporters have signed up, or null while we do not know yet. */
export const supporterCount = () => live.supporters;

/** Whether this supporter agreed to be emailed. */
export const emailOptIn = () => {
  const me = currentUser();
  return me ? Boolean(live.optIn[me.id]) : false;
};

export function setEmailOptIn(on) {
  if (!backend) {
    onError("Email settings need an account.");
    return;
  }
  const me = currentUser();
  if (me) live.optIn = { ...live.optIn, [me.id]: Boolean(on) };
  onChange();
  attempt(backend.setEmailOptIn(on).then(refresh), "That setting did not save.");
}

export const adminOverview = () => (backend ? backend.adminOverview() : Promise.resolve(null));
export const adminPeople = () => (backend ? backend.adminPeople() : Promise.resolve([]));

/* Early sight of the consultation results, before they go public. Read-only:
   it grants nothing over the raw responses, which stay volunteers-only. */
export const canViewResults = () => {
  const u = currentUser();
  return Boolean(u && (u.isAdmin || live.resultsViewers.has(u.id)));
};
export const isResultsViewer = (id) => live.resultsViewers.has(id);

export async function setResultsViewer(profileId, allowed) {
  if (!backend) return;
  await backend.setResultsViewer(profileId, allowed);
  await refresh();
}
export const archiveOfferList = () => (backend ? backend.archiveOfferList() : Promise.resolve([]));

export function setTag(profileId, tag) {
  if (!backend) return Promise.reject(new Error("Not connected."));
  return backend.setTag(profileId, tag).then(refresh);
}

export function isContributor(profileId) {
  if (!profileId) return false;
  return live.ground.some((r) => r.profile_id === profileId)
    || live.access.some((r) => r.profile_id === profileId)
    || live.pubs.some((r) => r.profile_id === profileId);
}

export function setAvatar(emblem) {
  if (!backend) {
    onError("Choosing a badge needs an account.");
    return;
  }
  const me = backend.profile?.id;
  if (me) live.avatars = { ...live.avatars, [me]: emblem };
  onChange();
  attempt(backend.setAvatar(emblem).then(refresh), "That badge did not save.");
}

/**
 * The kit an avatar is drawn on: colour and pattern together.
 *
 * Painted locally first so the picker responds on the tap rather than on the
 * round trip. Null for either means go back to working it out from the name.
 */
export function setAvatarStyle(kit, pattern) {
  if (!backend) {
    onError("Choosing a kit needs an account.");
    return;
  }
  const me = backend.profile?.id;
  if (me) {
    live.kits = { ...live.kits, [me]: kit || undefined };
    live.patterns = { ...live.patterns, [me]: pattern || undefined };
  }
  onChange();
  attempt(backend.setAvatarStyle(kit, pattern).then(refresh), "That kit did not save.");
}

/* --------------------------------------------------------- player ratings */

/* The squad is not a list anyone keeps up to date, so the app never hard codes
   one. Names come from the league's team sheets, or from a volunteer typing one
   in when the feed has none. */

export const lineupFor = (fixtureId) => live.lineups[fixtureId] || [];

export function deleteLineup(fixtureId) {
  if (!backend) return;
  attempt(backend.deleteLineup(fixtureId).then(refresh), "That team sheet did not come off.");
}

/** Which players have marks against them for a fixture, whoever gave them. */
export const ratedNamesFor = (fixtureId) =>
  live.ratings.match.filter((r) => r.fixture_id === fixtureId).map((r) => r.player_name);

export async function clearRatingsFor(fixtureId, names) {
  if (!backend) return 0;
  const n = await backend.clearRatingsFor(fixtureId, names);
  await refresh();
  return n;
}

export function saveLineup(fixtureId, players) {
  if (!backend) {
    onError("Team sheets need the online setup finishing first.");
    return;
  }
  live.lineups = { ...live.lineups, [fixtureId]: players };
  onChange();
  attempt(backend.saveLineup(fixtureId, players).then(refresh), "That team sheet did not save.");
}

/** Everyone's average for one player in one match, or null if nobody has rated. */
export const matchRating = (fixtureId, name) =>
  live.ratings.match.find((r) => r.fixture_id === fixtureId && r.player_name === name) || null;

/** This supporter's own mark, so the buttons can show what they picked. */
export const myRating = (fixtureId, name) =>
  live.ratings.mine[`${fixtureId}|${name}`] ?? null;

export const seasonRatings = () => live.ratings.season;

export function ratePlayer(fixtureId, name, rating) {
  if (!backend) {
    onError("Ratings need an account. Ask your fellow volunteers to finish the online setup.");
    return;
  }
  const key = `${fixtureId}|${name}`;
  const clearing = live.ratings.mine[key] === rating;
  const mine = { ...live.ratings.mine };
  if (clearing) delete mine[key];
  else mine[key] = rating;
  live.ratings = { ...live.ratings, mine };
  onChange();
  attempt(
    (clearing ? backend.clearRating(fixtureId, name) : backend.ratePlayer(fixtureId, name, rating))
      .then(refresh),
    "That rating did not save.",
  );
}

/* ------------------------------------------------------------------ access */

/* Reports from supporters who have actually been. There is no reliable source
   for this at Step 3, so an empty list means nobody has been yet, not that a
   ground is inaccessible. The app has to say which. */

export const accessFor = (clubSlug) =>
  live.access.filter((r) => r.club_slug === clubSlug && !r.hidden);

export function addAccessReport(clubSlug, report) {
  if (!backend) {
    onError("Access reports need an account. Ask your fellow volunteers to finish the online setup.");
    return;
  }
  attempt(backend.addAccess(clubSlug, report).then(refresh), "That report did not save.");
}

export function removeAccessReport(id) {
  live.access = live.access.filter((r) => r.id !== id);
  onChange();
  attempt(backend.removeAccess(id).then(refresh), "That deletion did not save.");
}

/* -------------------------------------------------------------------- pubs */

/* Like predictions, a supporter can add a recommendation before the online
   setup exists. Those stay on the device until Supabase is connected. */

const localPubs = () => read("local:pubs", []);
const saveLocalPubs = (rows) => write("local:pubs", rows);

export function pubsFor(clubSlug) {
  const rows = backend ? live.pubs : localPubs();
  return rows.filter((p) => p.club_slug === clubSlug);
}

export const votedForPub = (id) =>
  backend ? live.pubVotes.has(id) : read("local:pubVotes", []).includes(id);

export function addPub(clubSlug, details) {
  if (!backend) {
    const rows = localPubs();
    rows.unshift({
      id: uid(),
      club_slug: clubSlug,
      profile_id: currentUser()?.id || "anon",
      author_name: currentUser()?.name || "Anonymous",
      votes: 0,
      created_at: new Date().toISOString(),
      ...details,
    });
    saveLocalPubs(rows);
    onChange();
    return;
  }
  attempt(backend.addPub(clubSlug, details).then(refresh), "That suggestion did not save.");
}

export function removePub(id) {
  if (!backend) {
    saveLocalPubs(localPubs().filter((p) => p.id !== id));
    onChange();
    return;
  }
  live.pubs = live.pubs.filter((p) => p.id !== id);
  onChange();
  attempt(backend.removePub(id).then(refresh), "That deletion did not save.");
}

export function votePub(id) {
  if (!backend) {
    const voted = read("local:pubVotes", []);
    const on = !voted.includes(id);
    write("local:pubVotes", on ? [...voted, id] : voted.filter((v) => v !== id));
    saveLocalPubs(
      localPubs().map((p) => (p.id === id ? { ...p, votes: Math.max(0, (p.votes || 0) + (on ? 1 : -1)) } : p))
    );
    onChange();
    return;
  }
  const on = !live.pubVotes.has(id);
  if (on) live.pubVotes.add(id);
  else live.pubVotes.delete(id);
  const pub = live.pubs.find((p) => p.id === id);
  if (pub) pub.votes = Math.max(0, (pub.votes || 0) + (on ? 1 : -1));
  onChange();
  attempt(backend.votePub(id, on).then(refresh), "Your vote did not save.");
}

/* ---------------------------------------------------------------- feedback */

/** Anyone may send feedback, signed in or not. */
export async function sendFeedback(details) {
  if (!backend) {
    const queued = read("local:feedback", []);
    queued.unshift({ ...details, created_at: new Date().toISOString() });
    write("local:feedback", queued);
    return { queued: true };
  }
  await backend.sendFeedback(details);
  return { queued: false };
}

export const feedbackList = () => (backend ? backend.loadFeedback() : Promise.resolve(read("local:feedback", [])));

export function markFeedback(id, handled) {
  if (!backend) return;
  attempt(backend.markFeedback(id, handled), "That change did not save.");
}
