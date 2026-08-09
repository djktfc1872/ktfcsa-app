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
  avatars: {},              // profileId -> emblem key
  admins: new Set(),        // profileIds of KTFCSA volunteers
  lineups: {},              // fixtureId -> [{name, number, started}] typed in by a volunteer
  ratings: { match: [], season: [], mine: {} },
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
    /* Ratings arrived after the first release, so a database that has not had
       the newer tables added yet must not stop everything else refreshing. */
    try {
      const people = await backend.loadAvatars();
    live.avatars = people.avatars;
    live.admins = new Set(people.admins);
    live.lineups = await backend.loadLineups();
      live.ratings = await backend.loadRatings();
    } catch (err) {
      console.warn("Player ratings are not set up in the database yet:", err?.message || err);
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

export async function signUp(email, password, displayName) {
  const name = String(displayName || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name.length < 2) throw new Error("Please enter a name of at least two characters.");
  if (!backend) return signInLocal(name);
  const profile = await backend.signUp(email.trim(), password, name);
  await adoptGuestPredictions();
  await refresh();
  return profile;
}

export async function signIn(email, password) {
  if (!backend) return signInLocal(email);
  const profile = await backend.signIn(String(email).trim(), password);
  await adoptGuestPredictions();
  await refresh();
  return profile;
}

export async function signOut() {
  if (backend) {
    await backend.signOut();
    live.predictions = {};
    live.attendance = new Set();
    live.attendanceSummary = null;
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

/* ---------------------------------------------------------------- emblems */

/** The badge a supporter picked, or null if they are still on their initials. */
export const avatarOf = (profileId) => live.avatars[profileId] || null;

/** True when a profile belongs to a KTFCSA volunteer, so posts can say so. */
export const isVolunteer = (profileId) => live.admins.has(profileId);

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

/* --------------------------------------------------------- player ratings */

/* The squad is not a list anyone keeps up to date, so the app never hard codes
   one. Names come from the league's team sheets, or from a volunteer typing one
   in when the feed has none. */

export const lineupFor = (fixtureId) => live.lineups[fixtureId] || [];

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
