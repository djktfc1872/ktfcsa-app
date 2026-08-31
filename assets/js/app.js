/* Poppies Fan Companion - views and routing.
   Plain ES modules, no build step and no third party libraries. */

import { TEAMS, KTFC } from "./data.js";
import { CONFIG } from "./config.js";
import * as db from "./store.js";
import { QUIZ_EPOCH, londonToday, londonStamp, dayNumber, rngFor, seededShuffle } from "./quiz.js";

/* ================================================================= helpers */

const $ = (sel, root = document) => root.querySelector(sel);
/**
 * Builds DOM from an HTML string.
 *
 * One root element comes back as that element, which is what nearly every
 * caller wants. Several roots come back as a fragment holding all of them,
 * rather than silently dropping everything after the first. Getting that
 * wrong once cost us the whole sign-in form.
 */
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const { content } = t;
  return content.children.length === 1 ? content.firstElementChild : content;
};

/** Escapes anything a supporter typed before it goes near innerHTML. */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parseDate = (iso) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
};

function fmtDate(iso, style = "long") {
  const d = parseDate(iso);
  if (!d) return "Date to be confirmed";
  if (style === "short") return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function relTime(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const money = (v) => (v === "Free" || v === 0 ? "Free" : typeof v === "number" ? `£${v}` : v || "To be confirmed");

/* Pounds where the pence matter: an average, or a per-match figure. Whole
   pounds stay whole, so £250 does not become £250.00. */
const pounds = (n) => `£${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};

/* Getting somebody to the right place.

   Two things have already gone wrong here. A bare coordinate makes the mapping
   app snap to whatever POI is nearest, which at Bishop's Stortford is a college
   sharing the site. Naming the ground is worse, because most are called things
   like Woodside Park or The Grove and there is a residential street of that
   name somewhere else.

   The club name is the part that is actually distinctive, and it is what
   mapping apps hold as a business. So the destination is the club, then the
   ground, then the postcode, which narrows it to the right town. */

const clubQuery = (t) => {
  const name = t.name || t.stadium || "";
  const named = /\b(fc|f\.c\.|football club|afc)\b/i.test(name)
    ? name
    : `${name} Football Club`;
  return [named, t.stadium || t.ground, t.postcode].filter(Boolean).join(", ");
};

const placeUrl = (label, postcode) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [label, postcode].filter(Boolean).join(", ")
  )}`;

const mapUrl = (t) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clubQuery(t))}`;

/* What the place actually looks like. Every ground here has coordinates, so
   this works for all of them, and knowing which gate you are walking towards
   in the dark is worth more to an away fan than another map pin. */
const streetViewUrl = (t) =>
  (t.lat && t.lng
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${t.lat},${t.lng}`
    : null);

/* Only where a page was checked and actually resolves. Football Ground Guide
   sends anything it does not hold to its own home page, so an unverified link
   looks perfectly fine and takes somebody nowhere. */
const groundGuideUrl = (t) => state.groundLinks?.guides?.[t.id] || null;

const directionsUrl = (t) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    clubQuery(KTFC)
  )}&destination=${encodeURIComponent(clubQuery(t))}`;

/** League feeds spell clubs slightly differently to the spreadsheet. */
const normalise = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\b(f\.?c\.?|football club|afc)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

const teamByName = (name) => {
  const key = normalise(name);
  return TEAMS.find((t) => normalise(t.name) === key) ||
    TEAMS.find((t) => key.includes(normalise(t.name)) || normalise(t.name).includes(key)) ||
    null;
};

/** The feed writes "Stourbridge FC" where the club is known as "Stourbridge".
    Prefer the name supporters actually use, and fall back to the feed. */
const clubName = (name) => (/kettering/i.test(name) ? KTFC.name : teamByName(name)?.name || name);

/* Small inline icons. Kept as SVG so they render the same everywhere and need
   no font or network request. */
const ICON = {
  pin: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>`,
  /* Drawn rather than the YouTube wordmark: their brand rules are strict about
     how the logo may be used, and a play glyph credits the channel without
     borrowing a trademark to do it. */
  play: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10.2 15.1V8.9l5.4 3.1Z"/></svg>`,
  /* A navigation arrow. The previous winding-route glyph collapsed into
     something like a helicopter at thirteen pixels. */
  route: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2.2a1 1 0 0 1 .92.6l7.2 16.8a1 1 0 0 1-1.33 1.3L12 17.83l-6.79 3.07a1 1 0 0 1-1.33-1.3l7.2-16.8a1 1 0 0 1 .92-.6Z"/></svg>`,
  pint: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M6 3h12l-1.2 17.1A2 2 0 0 1 14.8 22H9.2a2 2 0 0 1-2-1.9L6 3Zm2.2 2 .2 3h7.2l.2-3H8.2Z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15.7 15.7 0 0 0-1.1-5.2A8 8 0 0 1 18.9 11ZM12 4.2c.7 1 1.5 2.9 1.8 6.8h-3.6c.3-3.9 1.1-5.8 1.8-6.8ZM4.3 13h3c.1 2 .5 3.8 1 5.2A8 8 0 0 1 4.3 13Zm3-2h-3a8 8 0 0 1 4-5.2A15.7 15.7 0 0 0 7.3 11ZM12 19.8c-.7-1-1.5-2.9-1.8-6.8h3.6c-.3 3.9-1.1 5.8-1.8 6.8Zm2.8-1.6c.5-1.4.9-3.2 1-5.2h3a8 8 0 0 1-4 5.2Z"/></svg>`,
  poppy: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" class="ic-poppy"><g fill="#c8323f"><ellipse cx="12" cy="6.8" rx="4.9" ry="4.5"/><ellipse cx="17.2" cy="12" rx="4.5" ry="4.9"/><ellipse cx="12" cy="17.2" rx="4.9" ry="4.5"/><ellipse cx="6.8" cy="12" rx="4.5" ry="4.9"/></g><circle cx="12" cy="12" r="3.4" fill="#7d111b"/><circle cx="12" cy="12" r="1.9" fill="#1b1b1f"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2Zm0-8h-2V7h2Z"/></svg>`,
  car: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5Zm2.1 0h9.8l-1-3H8.1l-1 3ZM6.5 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>`,
};

/**
 * Sits at the foot of every screen. Rendered by the shell, not by the views.
 *
 * `askForMoney` is off on the memorial page. Asking supporters to chip in for
 * hosting on a page about a children's charity puts our tin next to theirs, and
 * on that page there is only one thing worth giving to.
 */
function footer({ askForMoney = true } = {}) {
  const { name, email } = CONFIG.credit;
  const year = new Date().getFullYear();

  return el(`
    <footer class="site-footer">
      <div class="site-footer__mark">${ICON.poppy}</div>
      <div class="site-footer__main">
        Website by ${esc(name)}. All rights reserved.
      </div>
      <button class="link-btn site-footer__link" data-nav="association">About the Supporters&rsquo;
        Association</button>
      <a class="site-footer__mail" href="mailto:${esc(email)}">${esc(email)}</a>

      <!-- The refusal is the loud part on purpose. This app is free and has no
           adverts, and the moment a donation link starts to feel like a toll it
           has cost more than it raised. One line, across the page, in the
           footer where somebody has to go looking. -->
      ${askForMoney ? `
      <div class="kofi">
        <p class="kofi__text"><b>You never have to give anything.</b> The app is free, there are
        no adverts and nothing sits behind a paywall, and that does not change. If you want to
        chip in towards keeping it going, and towards the domain and hosting it runs on, there is
        a Ko-fi.</p>
        <a class="btn btn--sm btn--ghost kofi__go" href="https://ko-fi.com/ktfcsa"
           target="_blank" rel="noopener">Donate towards app fees</a>
      </div>` : ""}
      <div class="site-footer__meta">
        <span>&copy; ${year} Danny Jordan / Kettering Town FC Supporters' Association</span>
        <span class="site-footer__sep" aria-hidden="true">&middot;</span>
        <button class="link-btn site-footer__link" data-nav="privacy">Your data</button>
        <span class="site-footer__sep" aria-hidden="true">&middot;</span>
        <span>Fixtures from the Southern League</span>
        <span class="site-footer__sep" aria-hidden="true">&middot;</span>
        <span>Club notes from Wikipedia</span>
      </div>
    </footer>`);
}

/**
 * Runs an async action from a button, showing that it is working and putting
 * the button back however it ends. Without this a slow connection looks like
 * a dead tap, and people press again.
 */
async function withBusy(button, label, work) {
  if (button.dataset.busy === "1") return;
  const original = button.innerHTML;
  button.dataset.busy = "1";
  button.disabled = true;
  button.classList.add("is-busy");
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
  try {
    return await work();
  } finally {
    delete button.dataset.busy;
    button.disabled = false;
    button.classList.remove("is-busy");
    button.innerHTML = original;
  }
}

function toast(message, kind = "info") {
  $(".toast")?.remove();
  const mark = kind === "good" ? "✓" : kind === "bad" ? "!" : "";
  const node = el(`
    <div class="toast toast--${kind}" role="status" aria-live="polite">
      ${mark ? `<span class="toast__mark" aria-hidden="true">${mark}</span>` : ""}
      <span>${esc(message)}</span>
    </div>`);
  document.body.append(node);
  setTimeout(() => node.classList.add("is-leaving"), 2900);
  setTimeout(() => node.remove(), 3200);
}

function modal(html) {
  const bg = el(`<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => {
    if (e.target === bg) close();
  });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  });
  document.body.append(bg);
  bg.querySelector("input, textarea, select, button")?.focus();
  return { node: bg, close };
}

/* =================================================================== state */

const state = {
  view: "home",
  params: {},
  league: null,
  podcast: null,
  fixtureFilter: "all",
  playerTab: "rate",  // which part of Players & Stats is showing
  poppiesTab: "ground",  // which part of the Kettering Town page is showing
  predictTab: "open",
  clubInfo: {},   // background notes and official sites, from data/clubs.json
  overviews: {},  // our own club write-ups, from data/club-overviews.json
  videos: [],     // the club's YouTube uploads, from data/videos.json
  videoChannel: null, // the club's channel URL, so the page can credit it
  facts: null,    // researched club history, from data/club-facts.json
  association: null,  // who we are and what we stand for, from data/association.json
  valueReview: null,  // season ticket and gate price review, from data/value-review.json
  letter: null,       // the open letter to the club, from data/open-letter.json
  groundLinks: null,  // verified outbound ground guides, from data/ground-links.json
  parking: null,      // what each club says about parking, from data/parking.json
  pubsNearby: null,   // pubs mapped near each ground, from data/pubs-nearby.json
  attendances: null,  // last season's gates by club, from data/attendances.json
  topics: null,       // fan-started conversations, from topic_list
  topicCat: "",       // which category the list is filtered to, "" for all
  pointsInfo: null,   // the explainer's own copy of the weights, data/points.json
  pointsOpen: false,  // is the how-points-work fold open on the leaderboards
  wordleBank: null,   // the word list, from data/wordle-bank.json
  wordleTab: "play",
  bios: null,     // Darren Young's pen pics, from data/player-bios.json
  squad: null,    // the squad the club confirmed, from data/squad.json
  priceSources: {},   // club id -> the page the checker read its prices from
  priceSourcePromise: null,
  quiz: null,     // the Poppies Daily bank, fetched only when the game is opened
  quizById: null, // the same questions, keyed by id
  quizPromise: null,
  archive: null,      // past seasons, from data/archive.json
  archiveIndex: null, // that archive reduced to one row per player
  archivePromise: null,
  adminTab: "overview",  // which part of the admin panel is showing
  dailyTab: "play",
  resultsPublic: false,   // whether the consultation findings are on the public page
  questionGroups: null,   // the questions being written, and what is filed under each
  qTab: "list",           // which half of the workbench is showing
  qUnfiled: true,         // the sweep hides what is already filed
  qExcluded: [],          // deliberately not sent: allegations, abuse, not questions
  qRedact: "",            // names to take out of the addendum before it goes
  groupsLoaded: false,    // saved question groups have been read back once
  archiveOffers: null,    // how many have offered to help with the archive
  recovering: false,      // arrived from a password reset link
  peopleFilter: "all",    // which slice of the People tab is showing
  offerFilter: "all",     // which slice of the archive offers is showing
  peopleSort: "new",      // newest first, or alphabetical
  qReplyBy: "",           // the date a reply is asked for, so silence becomes a fact
  publishedPromise: null,
  dailyAnswers: [],   // right/wrong so far in today's run
};

/** Background on a club: founding year, a fuller description, official site. */
const infoFor = (slug) => state.clubInfo[slug] || null;

/** Our own write-up for a club, which reads better than the encyclopaedia one. */
const overviewFor = (slug) => state.overviews[slug] || null;

/** Fixtures come from the league feed. The spreadsheet fills in the away day
    detail. If the feed cannot be reached we build the list from the
    spreadsheet instead so the app is never empty. */
function fixtures() {
  if (state.league?.fixtures?.length) {
    return state.league.fixtures.map((f) => ({ ...f, team: teamByName(f.opponent) }));
  }
  return TEAMS.flatMap((t) => [
    { id: `${t.id}-h`, date: t.homeDate, kickoff: t.homeKickoff, venue: "Home", opponent: t.name,
      competition: "Premier Central", status: "upcoming", homeScore: null, awayScore: null, team: t },
    { id: `${t.id}-a`, date: t.awayDate, kickoff: t.awayKickoff, venue: "Away", opponent: t.name,
      competition: "Premier Central", status: "upcoming", homeScore: null, awayScore: null, team: t },
  ]).sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));
}

const nextFixture = () => {
  const today = todayISO();
  return fixtures().find((f) => f.date >= today && f.status !== "played") || null;
};

/* ================================================================== router */

/* nav: "tab" shows in the mobile bar, "more" lives behind the More screen,
   "hidden" is reachable by link only. The sidebar shows tab and more. */
/* Grouped by what a supporter is actually trying to do, not by the order these
   were built. The four tabs stay put: they are muscle memory on a phone. */
const ROUTES = {
  /* Declared first so it opens its own group at the top of the sidebar and the
     More screen, rather than sitting fifth under Supporters. It is on for five
     days and then the route stops advertising itself entirely. */
  /* Was "Have Your Say" while the survey was open. It closed on 21 August and
     the page is now the report, the questions and how long each has gone
     unanswered, so the name says that instead of inviting people to answer
     something they cannot. */
  consult: { label: "Consultation Report", short: "Report", icon: "📣", nav: "more",
    group: "Happening now", render: viewConsult },
  letter: { label: "Our Open Letter", short: "Letter", icon: "\u2709\uFE0F", nav: "more",
    group: "Happening now", render: viewLetter },
  meeting: { label: "The First Meeting", short: "Meeting", icon: "\uD83D\uDDE3\uFE0F", nav: "more",
    group: "Happening now", render: viewMeeting },
  home: { label: "Home", short: "Home", icon: ICON.poppy, nav: "tab", group: "Matchday", render: viewHome },
  fixtures: { label: "All Fixtures", short: "Fixtures", icon: "⚽", nav: "more", group: "Matchday", render: viewFixtures },
  table: { label: "Table", icon: "🏆", nav: "tab", group: "Matchday", render: viewTable },
  predict: { label: "Prediction League", short: "Predict", icon: "🎯", nav: "tab", group: "Matchday", render: viewPredict },
  players: { label: "Players & Stats", icon: "⭐", nav: "more", group: "Matchday", render: viewPlayers },
  archive: { label: "Player Archive", icon: "📚", nav: "more", group: "Matchday", render: viewArchive },

  travel: { label: "Travel", icon: "🚌", nav: "more", group: "Away days", render: viewTravel },
  clubs: { label: "Away Guide", icon: "📖", nav: "more", group: "Away days", render: viewClubs },
  map: { label: "Grounds Map", icon: "🗺️", nav: "more", group: "Away days", render: viewMap },

  /* What supporters do, and the Association itself. */
  association: { label: "Supporters\u2019 Association", short: "Association", icon: "\u{1F91D}",
    nav: "more", group: "Supporters", render: viewAssociation },
  wall: { label: "Fan Wall", icon: "\uD83D\uDCAC", nav: "tab", group: "Supporters", render: viewWall },

  heritage: { label: "Archive Project", icon: "\uD83D\uDCFC", nav: "more", group: "Supporters", render: viewHeritage },
  podcast: { label: "Poppycast", icon: "\uD83C\uDF99\uFE0F", nav: "more", group: "Supporters", render: viewPodcast },
  /* Was "Memorial Match" while there was a match to come. The page is about
     the charity now, and the charity is there all year. */
  memorial: { label: "Dylan Cecil Memorial Fund", short: "Memorial Fund", icon: "\uD83D\uDC99",
    nav: "more", group: "Supporters", render: viewMemorial },

  /* Two games rather than one buried among the notices. Poppies Daily is five
     questions once a day; Who Played More is endless. They belong together and
     neither belongs in a list with the archive project. */
  daily: { label: "Poppies Daily", short: "Daily", icon: "\uD83C\uDF3A",
    nav: "more", group: "Games", render: viewDaily },
  duel: { label: "Who Played More?", short: "Played More", icon: "\u2694\uFE0F",
    nav: "more", group: "Games", render: viewDuel },
  /* The boards live with the games rather than under You, because they are the
     reason to play one. */
  wordle: { label: "Poppies Wordle", short: "Wordle", icon: "\uD83D\uDFE5",
    nav: "more", group: "Games", render: viewWordle },
  /* The route key stays `standing` so any link already shared still opens.
     "Standing" on its own read like a league position; this page is six
     boards and a points total, so it says so. */
  standing: { label: "Leaderboards", icon: "\uD83C\uDFC5", nav: "more", group: "Games",
    render: viewStanding },

  /* About Kettering Town rather than about us. Nine things under one heading
     meant the Association sat in the same list as the club's video feed, and
     neither was easy to find. */
  poppies: { label: "Kettering Town", icon: ICON.poppy, nav: "more", group: "The club", render: viewPoppies },
  value: { label: "What It Costs", short: "Costs", icon: "\u{1F4B7}",
    nav: "more", group: "The club", render: viewValue },
  videos: { label: "Club Videos", icon: "\uD83D\uDCFA", nav: "more", group: "The club", render: viewVideos },

  season: { label: "My Season", icon: "📈", nav: "more", group: "You", render: viewSeason },
  account: { label: "Account", icon: "👤", nav: "more", group: "You", render: viewAccount },
  feedback: { label: "Send Feedback", icon: "✉️", nav: "more", group: "You", render: viewFeedback },

  more: { label: "More", icon: "⋯", nav: "hidden", render: viewMore },
  club: { label: "Club", icon: "📍", nav: "hidden", render: viewClub },
  privacy: { label: "Your data", icon: "🔒", nav: "hidden", render: viewPrivacy },
  thread: { label: "Discussion", icon: "💬", nav: "hidden", render: viewThread },
  topic: { label: "Topic", icon: "\uD83D\uDDE8\uFE0F", nav: "hidden", render: viewTopic },
  supporter: { label: "Supporter", icon: "\uD83D\uDC64", nav: "hidden", render: viewSupporter },
  points: { label: "How points work", icon: "\u2139\uFE0F", nav: "hidden", render: viewPoints },
  player: { label: "Player", icon: "⭐", nav: "hidden", render: viewPlayer },
  /* adminOnly now means "a moderator or better". What a moderator may actually
     do once inside is decided section by section, not by hiding the door. */
  admin: { label: "Admin", icon: "🛠️", nav: "more", group: "You", adminOnly: true, render: viewAdmin },
  match: { label: "Match", icon: "⚽", nav: "hidden", render: viewMatch },
  /* Reached from a fixture rather than the nav: it is always about one game,
     so a menu entry would have to ask which, and the fixture already knows. */
  plan: { label: "The plan", icon: "🗓️", nav: "hidden", render: viewPlan },
};

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  const hash = params.id
    ? `#/${view}/${params.id}${params.from ? `/${params.from}` : ""}`
    : `#/${view}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  countView();   /* pushState does not fire hashchange, so it is counted here */
  render({ toTop: true });
}

function readHash() {
  const [, view, id, from] = (location.hash || "#/home").split("/");
  /* #/consult/preview shows the findings early to whoever has been given
     sight of them. Anybody else is simply shown the survey. */
  state.view = ROUTES[view] ? view : "home";
  state.params = id
    ? { id: decodeURIComponent(id), from: from ? decodeURIComponent(from) : "" }
    : {};
}

/* =================================================================== chrome */

/* Everything waiting on a volunteer. Admin only, and zero for everybody else,
   so the badge simply never renders. Refreshed on nav paint rather than polled. */
let pendingWaiting = 0;
const pendingCount = () => (db.isModerator() ? pendingWaiting : 0);

/* Replies to things you wrote that you have not read.
 *
 * The wall had no way of telling anybody they had been answered: you posted,
 * and unless you happened to scroll back to the same thread days later you
 * never found out. Refreshed when the nav paints and whenever anybody posts,
 * since the app is already listening for that. */
let replyWaiting = 0;
const replyCount = () => (db.currentUser() ? replyWaiting : 0);
function refreshReplies() {
  if (!db.currentUser()) { replyWaiting = 0; return; }
  db.unseenReplies().then((rows) => {
    const n = rows.length;
    if (n !== replyWaiting) { replyWaiting = n; renderNav(); }
  }).catch(() => { /* not migrated yet */ });
}
function refreshPending() {
  if (!db.isModerator()) { pendingWaiting = 0; return; }
  db.pendingActions().then((p) => {
    const n = p ? (p.consultation || 0) + (p.polls || 0) + (p.feedback || 0) : 0;
    if (n !== pendingWaiting) { pendingWaiting = n; renderNav(); }
  }).catch(() => { /* not migrated yet */ });
}

/* Routes for a nav surface. adminOnly entries are dropped for everybody else,
   here rather than at each call site, so a new nav surface cannot forget. The
   page itself still checks: hiding a button is not a control. */
const routesWhere = (...kinds) =>
  Object.entries(ROUTES).filter(([, r]) =>
    kinds.includes(r.nav) && (!r.adminOnly || db.isModerator()));

function renderNav() {
  let lastGroup = null;
  $("#sidebar").innerHTML = routesWhere("tab", "more")
    .map(([key, r]) => {
      const heading = r.group && r.group !== lastGroup ? `<div class="sidebar__group">${r.group}</div>` : "";
      lastGroup = r.group;
      const waiting = key === "admin" ? pendingCount()
        : key === "wall" ? replyCount() : 0;
      const urgent = key === "consult" && consultState() === "open";
      return `${heading}
      <button class="sidebar__link ${state.view === key ? "is-active" : ""}${urgent ? " is-urgent" : ""}" data-nav="${key}">
        <span class="ic" aria-hidden="true">${r.icon}</span>${r.label}${
          urgent ? `<span class="live-dot" aria-hidden="true"></span>` : ""}${
          waiting ? `<span class="nav-badge">${waiting}</span>` : ""}
      </button>`;
    })
    .join("");

  /* The More screen stands in for everything that will not fit on a phone. */
  const onMore = routesWhere("more").some(([key]) => key === state.view) || state.view === "more";
  $("#tabbar").innerHTML =
    routesWhere("tab")
      .map(([key, r]) => `
        <button class="${state.view === key ? "is-active" : ""}" data-nav="${key}"
                aria-current="${state.view === key ? "page" : "false"}">
          <span class="ic" aria-hidden="true">${r.icon}</span>${r.short || r.label}${
            key === "wall" && replyCount()
              ? `<span class="nav-badge">${replyCount()}</span>` : ""}
        </button>`)
      .join("") +
    `<button class="${onMore ? "is-active" : ""}" data-nav="more"
             aria-current="${onMore ? "page" : "false"}">
       <span class="ic" aria-hidden="true">⋯</span>More${
         pendingCount() ? `<span class="nav-badge">${pendingCount()}</span>` : ""}
     </button>`;

  const user = db.currentUser();
  $("#account-btn").innerHTML = user
    ? avatarHtml(user.name, user.id)
    : `<span class="btn btn--sm">Sign in</span>`;
}

/* Text size.
 *
 * A supporter told us it was hard to read. Every font size in this app was in
 * pixels, which meant somebody who had already turned text up on their phone
 * got nothing from it: the app quietly overrode their own setting. They are in
 * rem now, so the browser's size carries, and this sits on top for anybody who
 * has never found that setting.
 *
 * Percentages of the root rather than a class per size, so one number moves
 * everything and nothing has to be kept in step. */
const TEXT_SIZES = [
  { key: "normal",  label: "Normal",  pct: 100 },
  { key: "large",   label: "Large",   pct: 115 },
  { key: "larger",  label: "Larger",  pct: 130 },
  { key: "largest", label: "Largest", pct: 150 },
];

const textSize = () => db.read("textSize", "normal");

function applyTextSize(key = textSize()) {
  const found = TEXT_SIZES.find((x) => x.key === key) || TEXT_SIZES[0];
  /* Left alone at Normal so the browser's own setting is what applies. Writing
     100% here would pin the page to sixteen pixels and undo exactly the thing
     this is meant to respect. */
  document.documentElement.style.fontSize = found.pct === 100 ? "" : `${found.pct}%`;
  document.documentElement.dataset.text = found.key;
}

function textSizePanel() {
  const box = el(`
    <div class="card a11y">
      <div class="info__label">Text size</div>
      <p class="hint" style="margin:2px 0 10px">Makes everything bigger, not just this page. If
        you have already made text larger on your phone, the app now follows that too.</p>
      <div class="a11y__row" role="group" aria-label="Text size"></div>
    </div>`);
  const row = $(".a11y__row", box);
  const paint = () => {
    row.textContent = "";
    TEXT_SIZES.forEach((sz) => {
      const on = textSize() === sz.key;
      const b = el(`<button class="a11y__btn${on ? " is-on" : ""}" type="button"
        aria-pressed="${on}" style="font-size:${sz.pct}%">${esc(sz.label)}</button>`);
      b.addEventListener("click", () => {
        db.write("textSize", sz.key);
        applyTextSize(sz.key);
        paint();
      });
      row.append(b);
    });
  };
  paint();
  return box;
}

function viewMore() {
  const wrap = el(`<div>
    <div class="page-head"><h1>More</h1><p>Everything else in the app.</p></div>
  </div>`);
  /* Above the list rather than buried behind Account, which needs signing in.
     Somebody who cannot read the app is not going to find a setting inside it. */
  wrap.append(textSizePanel());

  let seen = null;
  routesWhere("more").forEach(([key, r]) => {
    if (r.group && r.group !== seen) {
      wrap.append(el(`<h2 class="section-title">${esc(r.group)}</h2>`));
      seen = r.group;
    }
    wrap.append(el(`
      <button class="club-row${key === "consult" && consultState() === "open" ? " club-row--urgent" : ""}" data-nav="${key}">
        <span style="font-size:1.1875rem;width:26px;text-align:center" aria-hidden="true">${r.icon}</span>
        <div style="flex:1;min-width:0"><div class="club-row__name">${r.label}${
          key === "consult" && consultState() === "open"
            ? `<span class="club-row__sub">Closes ${CLOSES_WORDS}</span>` : ""}</div></div>
        ${key === "admin" && pendingCount() ? `<span class="nav-badge">${pendingCount()}</span>` : ""}
        ${key === "wall" && replyCount() ? `<span class="nav-badge">${replyCount()}</span>` : ""}
        <span style="color:var(--text-3)">›</span>
      </button>`));
  });
  return wrap;
}

/* Counted once per route per session. render() runs again every time data
   lands, and counting there would turn one visit into five. */
const counted = new Set();
function countView() {
  const route = state.view === "consult" && state.params?.id === "preview"
    ? "consult-preview" : state.view;
  if (counted.has(route)) return;
  counted.add(route);
  db.recordView(route);
}

function render({ toTop = false } = {}) {
  renderNav();
  refreshPending();
  refreshReplies();
  const main = $("#main");
  main.innerHTML = "";
  const node = ROUTES[state.view].render(state.params);
  node.classList.add("view");
  main.append(node);
  main.append(footer({ askForMoney: state.view !== "memorial" }));
  if (toTop) window.scrollTo(0, 0);
}

/* ================================================================ fixtures */

function fixtureCard(f, { isNext = false } = {}) {
  const d = parseDate(f.date);
  const played = f.status === "played" && f.homeScore !== null;
  const live = f.status === "live";
  const off = f.status === "off";
  const isHome = f.venue === "Home";

  let scoreHtml = "";
  if (played || live) {
    const ours = isHome ? f.homeScore : f.awayScore;
    const theirs = isHome ? f.awayScore : f.homeScore;
    const cls = ours > theirs ? "score--w" : ours < theirs ? "score--l" : "score--d";
    scoreHtml = `<div class="score ${cls}">${ours} - ${theirs}</div>`;
  }

  const statusPill = live
    ? `<span class="pill pill--live">Live</span>`
    : off
    ? `<span class="pill pill--off">${esc(f.rawStatus || "Off")}</span>`
    : `<span class="pill pill--${isHome ? "home" : "away"}">${isHome ? "Home" : "Away"}</span>`;

  const card = el(`
    <button class="fixture fixture--${isHome ? "home" : "away"} ${isNext ? "fixture--next" : ""}"
            data-match="${esc(f.id)}" data-club-fallback="${esc(f.team?.id || "")}"
            data-venue="${isHome ? "home" : "away"}">
      <div class="fixture__date">
        <div class="fixture__day">${d ? d.getDate() : "?"}</div>
        <div class="fixture__mon">${d ? MONTHS[d.getMonth()].slice(0, 3) : "TBC"}</div>
      </div>
      ${f.opponentCrest ? `<img class="fixture__crest" src="${esc(f.opponentCrest)}" alt="" loading="lazy">` : ""}
      <div class="fixture__body">
        <div class="fixture__opp">${esc(clubName(f.opponent))}</div>
        <div class="fixture__sub">${d ? DAYS[d.getDay()].slice(0, 3) : ""}${
          /* Naming the league on all 42 rows adds nothing. Cup ties are worth
             calling out, so only those get a competition label. */
          f.competition && !/premier central/i.test(f.competition) ? ` · ${esc(f.competition)}` : ""
        }${f.team && !isHome ? ` · ${f.team.distanceMiles} mi away` : ""}</div>
      </div>
      <div class="fixture__right">
        ${statusPill}
        ${scoreHtml || `<div class="fixture__ko">${esc(f.kickoff || "TBC")}</div>`}
      </div>
      <span class="fixture__chev" aria-hidden="true">›</span>
    </button>`);

  if (!f.team) card.style.cursor = "default";

  return card;
}

/**
 * Run something now, then on an interval, for as long as its node is on the
 * page.
 *
 * This exists because the same bug was written three times in one week. A
 * function builds a node, sets a timer to keep it up to date, and guards that
 * timer with "stop if the node has gone" - which is right, and which is wrong
 * on the very first call, because el() builds a node detached and the caller
 * appends it afterwards. At that moment the guard is asking whether something
 * that was never added is still there, and the honest answer stops the clock
 * before it starts.
 *
 * Fixing it each time meant remembering it each time: append before ticking,
 * or write `timer &&`, or both. Neither is visible in the shape of the code, so
 * neither survived being copied.
 *
 * Here the first run happens outside the guard entirely and the guard only ever
 * applies to later ones, by which time the node is either on the page or gone
 * for good. There is nothing left to remember and no order to get right.
 *
 * Returns a stop function, for callers that finish before their node does.
 */
function tickWhileOnPage(node, fn, everyMs) {
  fn();
  const timer = setInterval(() => {
    if (!document.contains(node)) { clearInterval(timer); return; }
    fn();
  }, everyMs);
  return () => clearInterval(timer);
}

function countdown(f) {
  const d = parseDate(f.date);
  if (!d) return "";
  const [h, m] = (f.kickoff || "15:00").split(":").map(Number);
  d.setHours(h || 15, m || 0, 0, 0);
  const diff = d - Date.now();
  if (diff <= 0) return "";
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `
    <div class="hero__countdown">
      <div class="cd"><b>${days}</b><span>Days</span></div>
      <div class="cd"><b>${hrs}</b><span>Hours</span></div>
      <div class="cd"><b>${mins}</b><span>Mins</span></div>
    </div>`;
}

function viewHome() {
  const all = fixtures();
  const today = todayISO();
  const next = nextFixture();
  const filter = state.fixtureFilter;

  const shown = all.filter((f) => {
    if (filter === "home") return f.venue === "Home";
    if (filter === "away") return f.venue === "Away";
    if (filter === "results") return f.status === "played";
    return f.status !== "played" || f.date >= today;
  });

  const liveNow = liveBanner();

  const wrap = el(`<div>
    <div class="ticker-slot"></div>
    <div class="page-head">
      <h1>Kettering Town</h1>
      <p>${esc(state.league?.season || "2026/27")}. Everything for following the Poppies, in one
      place, put together by supporters.</p>
    </div>

    <!-- The first thing anyone sees was a heading and a date range, which said
         nothing about what this is or who it is for. -->
    <div class="welcome">
      <div class="welcome__mark" aria-hidden="true">${ICON.poppy}</div>
      <div class="welcome__body">
        <h2>Welcome to the Poppies Fan Companion</h2>
        <p>Everything for following the Poppies this season, in one place. The fixtures and the
        table look after themselves, the away day guides tell you what it costs to get in, where
        to park and where to get a pint, and you can predict the scores, rate the players and
        have your say after every game.</p>
        <p class="welcome__sign">Free, no adverts, put together by supporters. Up the Poppies.</p>
      </div>
      <button class="welcome__close" type="button" aria-label="Hide this introduction">\u00D7</button>
    </div>

    <div class="live-slot"></div>
    <div class="called-slot"></div>
    <div class="hero-slot"></div>
    <div class="daily-slot"></div>
    <div class="otd-slot"></div>
    <div class="season-strip" data-nav="players" role="button" tabindex="0"></div>
    <div class="quick-links">
      <button class="ql" data-nav="predict">
        <span class="ql__icon" aria-hidden="true">\u{1F3AF}</span>
        <span class="ql__text"><b>Predict the score</b>Open to everyone, no account needed.</span>
      </button>
      <button class="ql" data-nav="players">
        <span class="ql__icon" aria-hidden="true">\u2B50</span>
        <span class="ql__text"><b>Players &amp; stats</b>Ratings, goals, cards and attendances.</span>
      </button>
      <button class="ql" data-nav="clubs">
        <span class="ql__icon" aria-hidden="true">\u{1F4D6}</span>
        <span class="ql__text"><b>Away day guide</b>Tickets, parking and a pub at every ground.</span>
      </button>
      <button class="ql" data-nav="wall">
        <span class="ql__icon" aria-hidden="true">\u{1F4AC}</span>
        <span class="ql__text"><b>Fan wall</b>A thread for every match, before and after.</span>
      </button>
    </div>
  </div>`);

  /* Goals, cards and gates were all sat behind one menu item nobody opened.
     The headline numbers now sit on the page everyone lands on, and tapping
     them goes through to the rest. */
  /* Says what this is to anyone arriving for the first time, then gets out of
     the way. Someone who comes every Saturday wants the next game, not the
     welcome mat, so closing it sticks. */
  const welcome = $(".welcome", wrap);
  if (welcome) {
    if (db.read("welcomeHidden", false)) welcome.remove();
    else {
      $(".welcome__close", welcome).addEventListener("click", () => {
        db.write("welcomeHidden", true);
        welcome.remove();
      });
    }
  }

  const strip = $(".season-strip", wrap);
  const stats = seasonStats();
  const rated = db.seasonRatings();
  if (strip) {
    if (!stats.played) {
      strip.remove();
    } else {
      const gates = stats.gates;
      const cells = [
        stats.scorers.length
          ? (() => {
              /* Surnames only, because the strip is four cells wide on a
                 phone. Level at the top reads as "Panter & Gyasi", and beyond
                 two it gives up and counts them. */
              const most = stats.scorers[0].goals;
              const tied = stats.scorers.filter((r) => r.goals === most);
              const surname = (n) => n.split(" ").slice(-1)[0];
              const label = tied.length === 1
                ? surname(tied[0].name)
                : tied.length === 2
                ? `${surname(tied[0].name)} & ${surname(tied[1].name)}`
                : `${tied.length} level`;
              return [tied.length > 1 ? "Top scorers" : "Top scorer", label,
                `${most} goal${most === 1 ? "" : "s"}`];
            })()
          : null,
        rated.length
          ? ["Best rated", rated[0].player_name.split(" ").slice(-1)[0], `${rated[0].average} out of 10`]
          : null,
        gates.length
          ? ["Average gate", Math.round(gates.reduce((n, g) => n + g, 0) / gates.length).toLocaleString("en-GB"), `${gates.length} home game${gates.length === 1 ? "" : "s"}`]
          : null,
      ].filter(Boolean);
      if (!cells.length) strip.remove();
      else {
        strip.append(el(`<div class="season-strip__label">Season so far</div>`));
        const row = el(`<div class="season-strip__row"></div>`);
        cells.forEach(([label, big, sub]) => row.append(el(`
          <div class="season-cell">
            <div class="season-cell__label">${esc(label)}</div>
            <div class="season-cell__big">${esc(big)}</div>
            <div class="season-cell__sub">${esc(sub)}</div>
          </div>`)));
        strip.append(row);
        strip.append(el(`<div class="season-strip__more">Goals, cards, attendances and ratings \u203A</div>`));
      }
    }
  }

  const heroSlot = $(".hero-slot", wrap);
  if (next) {
    const t = next.team;
    heroSlot.append(el(`
      <div class="hero">
        <div class="hero__label">Next fixture</div>
        <div class="hero__match">
          ${next.opponentCrest ? `<img class="hero__crest" src="${esc(next.opponentCrest)}" alt="">` : ""}
          <div>
            <h2 class="hero__opp">${esc(clubName(next.opponent))}</h2>
            <div class="hero__meta">${fmtDate(next.date)} · ${esc(next.kickoff || "Kick-off to be confirmed")}</div>
          </div>
        </div>
        <div class="hero__row">
          <span class="pill pill--${next.venue === "Home" ? "home" : "away"}">${esc(next.venue)}</span>
          ${next.competition ? `<span class="pill pill--gold">${esc(next.competition)}</span>` : ""}
          ${t && next.venue === "Away" ? `<span class="pill pill--muted">${t.distanceMiles} miles</span>` : ""}
        </div>
        ${countdown(next)}
        <div class="hero__row">
          <button class="btn btn--sm" data-plan="${esc(String(next.id))}">${
            next.venue === "Away" ? "Plan the away day" : "Matchday plan"}</button>
          ${t && next.venue === "Away"
            ? `<a class="btn btn--sm btn--ghost" href="${directionsUrl(t)}" target="_blank"
                  rel="noopener">Directions</a>` : ""}
        </div>
      </div>`));

    /* Predictions sit with the game they belong to rather than in a tab of
       their own. Anyone can have a go; the table needs an account. */
    if (predictionsOpen(next)) heroSlot.append(predictionCard(next, { compact: true }));
  }

  /* The list itself is its own page now. Home says what is next and where to
     go; it does not also try to be a forty-two row fixture list. */
  if (liveNow) $(".live-slot", wrap).append(liveNow);
  /* Above the next fixture, for the two days after a game when the last result
     is still the thing on everybody's mind. */
  $(".called-slot", wrap).append(exactCallout());
  const tick = consultTicker();
  if (tick) $(".ticker-slot", wrap).append(tick);
  const mem = memorialPromo();
  if (mem) $(".daily-slot", wrap).append(mem);
  /* Below the next fixture and the daily, not above them. The ticker at the top
     is the announcement; this is the state of it, and the state of something
     belongs further down than the news of it. */
  $(".otd-slot", wrap).before(replyWaitCard());
  const arch = archivePromo();
  if (arch) $(".daily-slot", wrap).append(arch);
  const promo = dailyPromo();
  if (promo) $(".daily-slot", wrap).append(promo);
  $(".otd-slot", wrap).append(onThisDayCard());

  /* Where the league stands, on the page people actually open. */
  if (db.isOnline()) $(".otd-slot", wrap).append(predictionSnapshot());

  const more = el(`
    <button class="ql ql--wide" data-nav="fixtures" style="margin-top:4px">
      <span class="ql__icon" aria-hidden="true">\u{1F4C5}</span>
      <span class="ql__text"><b>All fixtures and results</b>Every game this season, home and away.</span>
      <span class="ql__go" aria-hidden="true">\u203A</span>
    </button>`);
  wrap.append(more);
  return wrap;
}

function viewFixtures() {
  const all = fixtures();
  const today = todayISO();
  const next = nextFixture();
  const filter = state.fixtureFilter;
  const shown = all.filter((f) => {
    if (filter === "home") return f.venue === "Home";
    if (filter === "away") return f.venue === "Away";
    if (filter === "results") return f.status === "played";
    return f.status !== "played" || f.date >= today;
  });

  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fixtures</h1>
      <p>Every game this season, cup ties included, kept up to date on its own.</p>
    </div>
    <div class="how-to">
      <span class="how-to__row"><span class="pill pill--away">Away</span>
        Tap any fixture for the match, and the away day guide with it: tickets, parking and a pub.</span>
      <span class="how-to__row"><span class="pill pill--home">Home</span>
        Tap for the match, team sheet and everything on the visitors to ${esc(KTFC.ground)}.</span>
    </div>
  </div>`);

  const bar = el(`
    <div class="toolbar" style="margin-top:18px">
      <div class="segmented" role="group" aria-label="Filter fixtures">
        ${[["all", "Upcoming"], ["away", "Away"], ["home", "Home"], ["results", "Results"]]
          .map(([k, label]) => `<button data-filter="${k}" class="${filter === k ? "is-active" : ""}">${label}</button>`)
          .join("")}
      </div>
      <button class="btn btn--ghost toolbar__guide" data-nav="clubs">📖 Away guide</button>
    </div>`);
  bar.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      state.fixtureFilter = b.dataset.filter;
      render();
    })
  );
  wrap.append(bar);

  if (!shown.length) {
    wrap.append(el(`<div class="empty"><b>Nothing to show</b>No fixtures match that filter yet.</div>`));
    return wrap;
  }

  const ordered = filter === "results" ? [...shown].reverse() : shown;
  let lastMonth = "";

  /* The memorial match is a notice, not a fixture.
     It is deliberately never turned into a fixture object and never goes near
     league.json: predictions, match threads, player ratings and attendance all
     work by walking real fixtures, so a charity game that is not one of those
     cannot leak into any of them. It also means nobody can predict a score on
     somebody's memorial match, which is the whole point. */
  let memorialShown = memorialUpcoming() && filter !== "results" && filter !== "away";
  const maybeMemorial = (beforeDate) => {
    if (!memorialShown) return;
    if (beforeDate && beforeDate <= MEMORIAL.date) return;
    memorialShown = false;
    wrap.append(memorialNotice());
  };

  ordered.forEach((f) => {
    const d = parseDate(f.date);
    const key = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "Date to be confirmed";
    if (key !== lastMonth) {
      lastMonth = key;
      wrap.append(el(`<div class="month">${esc(key)}</div>`));
    }
    maybeMemorial(f.date);
    wrap.append(fixtureCard(f, { isNext: next && f.id === next.id }));
  });
  maybeMemorial(null);

  wrap.append(sourceStamp());
  return wrap;
}

function sourceStamp() {
  if (!state.league) {
    return el(`<div class="stamp"><span class="dot dot--stale"></span>Showing the fixture list saved in the app. Live updates were not available.</div>`);
  }
  const mins = Math.round((Date.now() - new Date(state.league.updated)) / 60000);
  const age = mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
  return el(`<div class="stamp"><span class="dot"></span>Fixtures and table from ${esc(state.league.source)}. Updated ${esc(age)}.</div>`);
}

/* =================================================================== table */

function viewTable() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>League Table</h1>
      <p>${esc(state.league?.competition || "Southern League Premier Central")}, ${esc(state.league?.season || "2026/27")}.</p>
    </div>
  </div>`);

  const rows = state.league?.table || [];
  if (!rows.length) {
    wrap.append(el(`<div class="empty"><b>Table not available</b>The league feed could not be reached. Pull down to refresh, or try again shortly.</div>`));
    return wrap;
  }

  /* Phones only ever see five columns, because ten will not fit. This puts the
     other five back for anyone who wants them, by shrinking the type rather
     than making the page scroll sideways. Hidden on desktop, where the full
     table already fits. */
  const fullToggle = el(`
    <button class="cols-toggle" type="button" aria-expanded="false">Show more columns</button>`);
  fullToggle.addEventListener("click", () => {
    const on = table.classList.toggle("is-expanded");
    fullToggle.setAttribute("aria-expanded", String(on));
    fullToggle.textContent = on ? "Show fewer columns" : "Show more columns";
  });
  wrap.append(fullToggle);

  const table = el(`
    <div class="table-wrap">
      <table class="league league--full">
        <thead>
          <tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>GD</th><th class="col-form">Form</th><th>Pts</th></tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr class="${/kettering/i.test(r.name) ? "is-ktfc" : ""}">
              <td>${r.position}</td>
              <td>${(() => {
                /* Every club in the table has a page: ours, or the away guide
                   entry for everybody else. A club nobody has an entry for
                   stays plain text rather than becoming a dead button. */
                const us = /kettering/i.test(r.name);
                const t = us ? null : teamByName(r.name);
                const inner = `
                  <span class="club-cell">
                    ${r.crest ? `<img src="${esc(r.crest)}" alt="" loading="lazy">` : ""}
                    <span>${esc(clubName(r.name))}</span>
                  </span>`;
                if (us) return `<button class="club-link" data-nav="poppies">${inner}</button>`;
                if (t) return `<button class="club-link" data-club="${esc(t.id)}">${inner}</button>`;
                return `<div class="club-cell">${inner}</div>`;
              })()}</td>
              <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
              <td>${r.for}</td><td>${r.against}</td>
              <td>${r.goalDifference > 0 ? "+" : ""}${r.goalDifference}</td>
              <td class="col-form">${formRun(r.form)}</td>
              <td class="pts">${r.points}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`);
  wrap.append(table);

  if (rows.every((r) => r.played === 0)) {
    wrap.append(el(`<div class="notice notice--info" style="margin-top:14px">The season has not kicked off yet, so every club starts on zero. The table fills in on its own once results come through.</div>`));
  }

  wrap.append(sourceStamp());
  return wrap;
}

/* ============================================================== predictions */

/** Kick-off as a real instant, so predictions lock at the right moment. */
function kickoffTime(f) {
  const d = parseDate(f.date);
  if (!d) return null;
  const [h, m] = (f.kickoff || "15:00").split(":").map(Number);
  d.setHours(h || 15, m || 0, 0, 0);
  return d;
}

const predictionsOpen = (f) => {
  const ko = kickoffTime(f);
  return Boolean(ko) && ko > new Date() && f.status !== "played" && f.status !== "off";
};

function viewPredict() {
  const user = db.currentUser();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Prediction League</h1>
      <p>${CONFIG.scoring.exact} points for the exact score, ${CONFIG.scoring.outcome} for the right result.
         Predictions close at kick-off and sit under each fixture.</p>
    </div>
  </div>`);

  if (!db.isOnline()) {
    wrap.append(el(`<div class="notice notice--warn">
      The leaderboard needs supporter accounts, which are part of the online setup.
      Predictions still work in the meantime and are kept on this device.
    </div>`));
  } else if (!user) {
    wrap.append(el(`<div class="notice notice--info">
      Anyone can predict. Join to appear on the leaderboard, and the predictions
      you have already made come with you.
    </div>`));
  }

  const tabs = el(`
    <div class="segmented" style="margin-bottom:16px" role="group" aria-label="Predictions view">
      <button data-ptab="open" class="${state.predictTab === "table" ? "" : "is-active"}">Fixtures</button>
      <button data-ptab="table" class="${state.predictTab === "table" ? "is-active" : ""}">Leaderboard</button>
    </div>`);
  tabs.querySelectorAll("[data-ptab]").forEach((b) =>
    b.addEventListener("click", () => {
      state.predictTab = b.dataset.ptab;
      render();
    })
  );
  wrap.append(tabs);

  if (state.predictTab === "table") {
    if (!user) {
      wrap.append(el(`<div class="empty"><b>The leaderboard needs an account</b>It is the one part that cannot work without knowing who is who.</div>`));
      wrap.append(el(`<div class="btn-row" style="justify-content:center"><button class="btn" data-nav="account">Join or sign in</button></div>`));
    } else {
      wrap.append(predictionTable());
    }
    return wrap;
  }

  const all = fixtures();
  const open = all.filter(predictionsOpen);
  const settled = all.filter((f) => f.status === "played" && f.homeScore !== null);

  if (!open.length) {
    wrap.append(el(`<div class="empty"><b>Nothing to predict</b>Come back when the next fixture is announced.</div>`));
  }

  open.slice(0, 12).forEach((f) => wrap.append(predictionCard(f)));

  if (settled.length) {
    wrap.append(el(`<h2 class="section-title">Results so far</h2>`));
    settled.slice(-10).reverse().forEach((f) => wrap.append(predictionCard(f, { settled: true })));
  }

  return wrap;
}

function predictionCard(f, { settled = false, compact = false } = {}) {
  const mine = db.myPrediction(f.id);
  const isHome = f.venue === "Home";
  const ktfc = "Kettering";
  const left = isHome ? ktfc : clubName(f.opponent);
  const right = isHome ? clubName(f.opponent) : ktfc;

  let earned = null;
  if (settled && mine) {
    const exact = mine.home === f.homeScore && mine.away === f.awayScore;
    const outcome = Math.sign(mine.home - mine.away) === Math.sign(f.homeScore - f.awayScore);
    earned = exact ? CONFIG.scoring.exact : outcome ? CONFIG.scoring.outcome : 0;
  }

  const card = el(`
    <div class="predict${compact ? " predict--compact" : ""}">
      <div class="predict__head">
        ${compact
          ? `<span class="predict__label">Your prediction</span>`
          : `<span class="pill pill--${isHome ? "home" : "away"}">${esc(f.venue)}</span>
             <span class="predict__when">${esc(fmtDate(f.date, "short"))} · ${esc(f.kickoff || "TBC")}</span>
             ${f.competition ? `<span class="pill pill--muted">${esc(f.competition)}</span>` : ""}`}
      </div>
      <div class="predict__teams">
        <span class="predict__team">${esc(left)}</span>
        <span class="predict__score"></span>
        <span class="predict__team predict__team--right">${esc(right)}</span>
      </div>
    </div>`);

  const slot = card.querySelector(".predict__score");

  if (settled) {
    slot.innerHTML = `<b>${f.homeScore} - ${f.awayScore}</b>`;
    card.append(el(`
      <div class="predict__result">
        ${mine
          ? `You said ${mine.home} - ${mine.away} · <b class="${earned ? "pts-win" : "pts-none"}">${earned} point${earned === 1 ? "" : "s"}</b>`
          : "You did not predict this one."}
      </div>`));
    return card;
  }

  const inputs = el(`
    <span class="predict__inputs">
      <input type="number" min="0" max="20" inputmode="numeric" aria-label="${esc(left)} score" value="${mine ? mine.home : ""}">
      <span>-</span>
      <input type="number" min="0" max="20" inputmode="numeric" aria-label="${esc(right)} score" value="${mine ? mine.away : ""}">
    </span>`);
  slot.replaceWith(inputs);

  const [homeIn, awayIn] = inputs.querySelectorAll("input");
  const signedIn = Boolean(db.currentUser());
  const save = el(`<button class="btn btn--sm">${mine ? "Update" : "Predict"}</button>`);

  const statusText = () => {
    if (mine && signedIn) return "Saved. You can change it until kick-off.";
    if (mine) return "Saved on this device. Join to get it on the leaderboard.";
    return "Open to everyone. Closes at kick-off.";
  };
  const status = el(`<div class="predict__result">${statusText()}</div>`);

  save.addEventListener("click", () => {
    /* Number("") is 0, so an empty box used to save quietly as a 0-0 rather
       than asking for a score. Check the text before trusting the number. */
    const rawH = homeIn.value.trim();
    const rawA = awayIn.value.trim();
    if (!rawH || !rawA) {
      [homeIn, awayIn].forEach((i) => {
        if (!i.value.trim()) {
          i.classList.add("is-wrong");
          setTimeout(() => i.classList.remove("is-wrong"), 900);
        }
      });
      (!rawH ? homeIn : awayIn).focus();
      return toast("Put a score in both boxes.", "bad");
    }
    const h = Number(rawH);
    const a = Number(rawA);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 20 || a > 20) {
      return toast("Enter a score between 0 and 20 for both sides.", "bad");
    }
    if (!predictionsOpen(f)) return toast("That match has kicked off, so predictions are closed.", "bad");
    db.savePrediction(f.id, h, a);
    save.classList.add("did-save");
    setTimeout(() => save.classList.remove("did-save"), 700);
    toast(signedIn ? "Prediction saved." : "Saved on this device.", "good");
    render();
  });

  const row = el(`<div class="predict__actions"></div>`);
  row.append(save);
  card.append(row);
  card.append(status);

  /* A guest keeps their predictions locally. Signing up carries them over, so
     nothing is lost by having a go first. Only nudge on the fixtures screen;
     the league page already explains it once at the top. */
  if (!signedIn && compact) {
    const nudge = el(`<div class="predict__nudge">
      <button class="link-btn">Join to appear on the leaderboard</button>
    </div>`);
    nudge.querySelector("button").addEventListener("click", () => go("account"));
    card.append(nudge);
  }

  return card;
}

/**
 * The top of the prediction league, on the home page.
 *
 * The table was one tap away and nobody taps. A league nobody can see the top
 * of is not a league, and the point of it is that people know where they are.
 * Your own row is pulled in underneath if you are not already in the five, so
 * it always says something about you rather than only about the leaders.
 */
function predictionSnapshot() {
  const box = el(`<div></div>`);
  db.predictionLeague().then((rows) => {
    if (!rows.length) return;
    const me = db.currentUser()?.id;
    const top = rows.slice(0, 5);
    const mineAt = rows.findIndex((r) => r.profile_id === me);
    const alsoMe = mineAt >= 5 ? rows[mineAt] : null;

    const card = el(`
      <div class="card ladder">
        <div class="ladder__head">
          <span>Prediction league</span>
          <button class="link-btn" data-nav="predict">Full table ›</button>
        </div>
      </div>`);

    const row = (r, pos) => el(`
      <button class="ladder__row${r.profile_id === me ? " ladder__row--me" : ""}" data-nav="predict">
        <span class="ladder__pos">${pos}</span>
        <span class="ladder__who">${namePlusTag(r.profile_id, r.display_name)}</span>
        <span class="ladder__meta">${r.exact_scores} exact</span>
        <span class="ladder__pts">${r.points}</span>
      </button>`);

    top.forEach((r, i) => card.append(row(r, i + 1)));
    if (alsoMe) {
      card.append(el(`<div class="ladder__gap" aria-hidden="true">···</div>`));
      card.append(row(alsoMe, mineAt + 1));
    }
    card.append(el(`<p class="hint">${
      me ? "Predictions close at kick-off." : "Join to get on the table. Predicting works without an account."
    }</p>`));
    box.append(card);
  }).catch(() => { /* the home page is fine without it */ });
  return box;
}

function predictionTable() {
  const box = el(`<div><div class="skeleton" style="height:120px"></div></div>`);
  db.predictionLeague()
    .then((rows) => {
      box.innerHTML = "";
      if (!rows.length) {
        box.append(el(`<div class="empty"><b>No scores yet</b>The table fills in once results start coming through.</div>`));
        return;
      }
      const me = db.currentUser()?.id;
      box.append(el(`
        <div class="table-wrap">
          <table class="league">
            <thead><tr><th>#</th><th>Supporter</th><th>P</th><th>Exact</th><th>Pts</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr class="${r.profile_id === me ? "is-ktfc" : ""}">
                  <td>${i + 1}</td>
                  <td><div class="club-cell">${namePlusTag(r.profile_id, r.display_name)}</div></td>
                  <td>${r.played}</td><td>${r.exact_scores}</td><td class="pts">${r.points}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`));
    })
    .catch(() => {
      box.innerHTML = "";
      box.append(el(`<div class="empty"><b>Table unavailable</b>Please try again shortly.</div>`));
    });
  return box;
}

/* ================================================================ my season */

/**
 * Grounds ticked off, out of the division.
 *
 * Built entirely from attendance that is already recorded, so it costs nothing
 * to keep: an away game you were at means you have been to that ground, and a
 * home game means Latimer Park. Non-league supporters count grounds the way
 * other people count countries, and the app had every piece of this and was
 * showing none of it.
 *
 * This season only, and it says so. Attendance is not recorded for earlier
 * seasons and quietly implying otherwise would make the number a lie.
 */
function groundsVisited() {
  const wrap = el(`<div></div>`);
  const gone = fixtures().filter((f) => f.date <= todayISO());

  /* One row per ground, not per fixture: two trips to the same place is still
     one ground. */
  const seen = new Map();
  let homeVisits = 0;
  gone.forEach((f) => {
    if (!db.didAttend(f.id)) return;
    if (f.venue !== "Away") { homeVisits += 1; return; }
    if (!f.team) return;
    const prev = seen.get(f.team.id);
    if (!prev || f.date < prev.date) seen.set(f.team.id, { team: f.team, date: f.date });
  });

  /* Ticked by hand, for the decades before this app existed. Attendance can
     only ever know about this season, and a groundhopper's list that starts in
     August 2026 is not their list. */
  const ticked = db.groundVisits();

  const away = TEAMS.filter((t) => typeof t.distanceMiles === "number");
  const total = away.length + 1;                 /* every away ground, plus ours */
  const beenTo = (id) => seen.has(id) || ticked.has(id);
  const done = away.filter((t) => beenTo(t.id)).length
    + (homeVisits || ticked.has("kettering-town") ? 1 : 0);

  wrap.append(el(`<h2 class="section-title">Grounds ticked off</h2>`));
  const card = el(`<div class="card"></div>`);

  card.append(el(`
    <div class="grounds__top">
      <div>
        <div class="grounds__count">${done}<span>of ${total}</span></div>
        <div class="grounds__sub">${done === total
          ? "The whole division. Every ground in it, this season."
          : `${total - done} to go for the full set this season`}</div>
      </div>
      <div class="grounds__ring" style="--pct:${Math.round((done / total) * 100)}"
           role="img" aria-label="${done} of ${total} grounds visited"></div>
    </div>`));

  const list = el(`<div class="grounds__list"></div>`);
  const rows = [
    { team: { id: "kettering-town", name: KTFC.name, stadium: KTFC.ground },
      date: homeVisits ? "home" : null, home: true, been: Boolean(homeVisits) || ticked.has("kettering-town") },
    ...away
      .map((t) => ({ team: t, date: seen.get(t.id)?.date || null, been: beenTo(t.id) }))
      .sort((a, b) => {
        if (a.been !== b.been) return a.been ? -1 : 1;
        return a.team.name.localeCompare(b.team.name);
      }),
  ];

  rows.forEach((r) => {
    const been = r.been;
    const auto = r.home ? Boolean(homeVisits) : seen.has(r.team.id);
    const when = r.home
      ? (homeVisits ? `${homeVisits} game${homeVisits === 1 ? "" : "s"} at home` : "Ticked off")
      : auto ? `First visit ${fmtDate(r.date, "short")}`
      : been ? "Ticked off" : `${r.team.distanceMiles} miles away`;
    /* The tick is its own control so the row can still open the ground's page.
       One that came from marking attendance is not tickable here: the game is
       where that belongs, and two places to change one fact drift apart. */
    const row = el(`
      <div class="ground${been ? " ground--been" : ""}">
        <button class="ground__tick${auto ? " ground__tick--auto" : ""}" type="button"
          aria-pressed="${been}" title="${auto
            ? "From a game you marked as attended"
            : been ? "Been there. Tap to untick." : "Tap if you have been"}"
          ${auto ? "disabled" : ""}>${been ? "\u2713" : ""}</button>
        <button class="ground__who" type="button"${
          r.home ? ' data-nav="poppies"' : ` data-club="${esc(r.team.id)}"`}>
          <span class="ground__name">${esc(r.team.name)}</span>
          <span class="ground__where">${esc(r.team.stadium)} &middot; ${esc(when)}</span>
        </button>
      </div>`);
    if (!auto) {
      const tick = row.querySelector(".ground__tick");
      tick.addEventListener("click", async () => {
        tick.disabled = true;
        try {
          await db.setGroundVisit(r.team.id, !been, r.date && r.date !== "home" ? r.date : null);
        } catch (err) {
          toast(err.message || "That did not save.", "bad");
        }
        tick.disabled = false;
      });
    }
    list.append(row);
  });
  card.append(list);
  card.append(el(`<p class="hint">This season fills itself in from the games you tick off above.
    Anything before that, tap the circle: plenty of people have been going for thirty years and a
    list that starts in August is not their list. Nobody else sees it, and there is no table of who
    has been to most, because it is a collection rather than a competition.</p>`));

  wrap.append(card);
  return wrap;
}

function viewSeason() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>My Season</h1>
      <p>Tick off the games you were at. The miles count the return trip to away grounds.</p>
    </div>
  </div>`);

  if (!db.isOnline()) {
    wrap.append(el(`<div class="notice notice--warn">
      Attendance tracking needs supporter accounts, which are part of the online setup.
    </div>`));
  }

  const user = db.currentUser();
  if (!user) {
    wrap.append(joinPrompt({
      heading: "Keep a record of your season",
      blurb: "Tick off every game you go to and the app keeps count for you, home and away.",
      points: [
        "Games watched, and the miles you have put in getting there",
        "Follows your account, so it is the same on your phone and at home",
        "Nobody sees your record but you",
      ],
    }));
    return wrap;
  }

  const s = db.attendanceSummary();
  wrap.append(el(`
    <div class="info-grid info-grid--4" style="margin-bottom:6px">
      <div class="info"><div class="info__label">Games</div><div class="info__value">${s?.games ?? 0}</div></div>
      <div class="info"><div class="info__label">Home</div><div class="info__value">${s?.home_games ?? 0}</div></div>
      <div class="info"><div class="info__label">Away</div><div class="info__value">${s?.away_games ?? 0}</div></div>
      <div class="info"><div class="info__label">Miles</div><div class="info__value" style="color:var(--accent)">${(s?.miles ?? 0).toLocaleString("en-GB")}</div></div>
    </div>`));

  const badges = earnedBadges(s);
  if (badges.length) {
    wrap.append(el(`<h2 class="section-title">Earned</h2>`));
    wrap.append(el(`<div class="badge-row">${badges.map((b) => `<span class="badge badge--gold">${esc(b)}</span>`).join("")}</div>`));
  }

  wrap.append(el(`<h2 class="section-title">Games so far</h2>`));

  const gone = fixtures().filter((f) => f.date <= todayISO());
  if (!gone.length) {
    wrap.append(el(`<div class="empty"><b>The season has not started</b>Come back after the first game.</div>`));
    return wrap;
  }

  gone.slice().reverse().forEach((f) => {
    const on = db.didAttend(f.id);
    const row = el(`
      <button class="attend ${on ? "is-on" : ""}">
        <span class="attend__tick" aria-hidden="true">${on ? "✓" : ""}</span>
        <span class="attend__body">
          <span class="attend__opp">${esc(clubName(f.opponent))}</span>
          <span class="attend__meta">${esc(fmtDate(f.date, "short"))} · ${esc(f.venue)}${
            f.venue === "Away" && f.team ? ` · ${f.team.distanceMiles * 2} miles there and back` : ""
          }</span>
        </span>
        ${f.homeScore !== null && f.homeScore !== undefined
          ? `<span class="attend__score">${f.homeScore} - ${f.awayScore}</span>` : ""}
      </button>`);
    row.setAttribute("aria-pressed", String(on));
    row.addEventListener("click", () => db.setAttendance(f.id, !on));
    wrap.append(row);
  });

  /* Before the leaderboard: what you have done, then how it compares. */
  wrap.append(groundsVisited());

  wrap.append(el(`<h2 class="section-title">Who has been where</h2>`));
  const board = el(`<div><div class="skeleton" style="height:100px"></div></div>`);
  db.attendanceTable()
    .then((rows) => {
      board.innerHTML = "";
      if (!rows.length) {
        board.append(el(`<div class="empty"><b>Nobody has ticked a game yet</b>Be the first.</div>`));
        return;
      }
      const me = db.currentUser()?.id;
      board.append(el(`
        <div class="table-wrap">
          <table class="league">
            <thead><tr><th>#</th><th>Supporter</th><th>Games</th><th>Away</th><th>Miles</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr class="${r.profile_id === me ? "is-ktfc" : ""}">
                  <td>${i + 1}</td>
                  <td><div class="club-cell">${namePlusTag(r.profile_id, r.display_name)}</div></td>
                  <td>${r.games}</td><td>${r.away_games}</td>
                  <td class="pts">${r.miles.toLocaleString("en-GB")}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`));
    })
    .catch(() => {
      board.innerHTML = "";
    });
  wrap.append(board);
  return wrap;
}

function earnedBadges(s) {
  if (!s) return [];
  const out = [];
  if (s.games >= 1) out.push("First game");
  if (s.away_games >= 5) out.push("Five aways");
  if (s.away_games >= 10) out.push("Ten aways");
  if (s.away_games >= 21) out.push("Every away ground");
  if (s.miles >= 500) out.push("500 miles");
  if (s.miles >= 1000) out.push("1,000 miles");
  if (s.miles >= 2000) out.push("2,000 miles");
  return out;
}

/* =============================================================== away guide */

/**
 * Last season's away gates, in three sentences.
 *
 * Written flat on purpose. The numbers are good enough that dressing them up
 * would make them read as a boast rather than a finding, and the sentence that
 * matters most is the last one: it says where it did not happen. A stat that
 * only ever points one way is a stat nobody outside the club will believe, and
 * this app's whole argument to the club is that it does not do that.
 */
function awayFollowing() {
  const a = state.attendances;
  const sw = a?.swing;
  if (!sw || !sw.percent || sw.percent <= 0) return null;

  const quieter = (a.clubs || []).filter((c) => c.sway !== null && c.sway < 0).length;
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const n = (x) => words[x] || String(x);

  return el(`
    <div class="card following-card">
      <div class="info__label">Away gates, ${esc(a.season)}</div>
      <p>The ${n(sw.grounds)} clubs we visited averaged <b>${
        sw.theirAverage.toLocaleString("en-GB")}</b> at home without us there, and <b>${
        sw.withKettering.toLocaleString("en-GB")}</b> on the day we came.</p>
      <p class="hint">${quieter
        ? `Not everywhere: ${n(quieter)} of the ${n(sw.grounds)} were quieter with us there than
           without. `
        : ""}Home league games only, from the Southern League's own figures. Each club's page has
        its own.</p>
    </div>`);
}

function viewClubs() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Away Guide</h1>
      <p>Ground details, ticket prices, parking and a decent pub for all ${TEAMS.length} clubs.</p>
    </div>
    <div class="following-slot"></div>
    <div class="field"><input type="search" id="club-search" placeholder="Search clubs" aria-label="Search clubs"></div>
    <div id="club-list"></div>
  </div>`);

  loadAttendances().then(() => {
    const f = awayFollowing();
    if (f) $(".following-slot", wrap).append(f);
  }).catch(() => { /* the guide is the point of this page, not the stat */ });

  const listEl = $("#club-list", wrap);
  const paint = (q = "") => {
    const hits = TEAMS.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
    listEl.innerHTML = "";
    if (!hits.length) {
      listEl.append(el(`<div class="empty"><b>No clubs found</b>Try a different search.</div>`));
      return;
    }
    hits.forEach((t) =>
      listEl.append(el(`
        <button class="club-row" data-club="${esc(t.id)}">
          <div style="flex:1;min-width:0">
            <div class="club-row__name">${esc(t.name)}</div>
            <div class="club-row__sub">${esc(t.stadium)} · ${esc(t.postcode)}</div>
            ${db.groundFor(t.id).length
              ? ""
              : `<div class="club-row__gap">Nobody has reported on this ground yet</div>`}
          </div>
          <span class="badge">${t.distanceMiles} mi</span>
          <span style="color:var(--text-3)">›</span>
        </button>`))
    );
  };
  paint();
  $("#club-search", wrap).addEventListener("input", (e) => paint(e.target.value));
  return wrap;
}

/* Clubs publish concessions inconsistently. Where the spreadsheet's ticket
   note spells out who qualifies we use that; otherwise we say what is usual at
   this level and tell people to check, rather than inventing an age. */
const CONCESSION_HINTS = [
  [/over\s*65|65\+|senior/i, "Over 65s"],
  [/student/i, "Students"],
  [/nhs/i, "NHS"],
  [/armed forces|forces|veteran/i, "Armed Forces"],
  [/disab/i, "Disabled supporters"],
];

/** Who the club actually says qualifies, or null when they have not said. */
function concessionAges(t) {
  const found = CONCESSION_HINTS.filter(([re]) => re.test(t.ticketNotes || "")).map(([, l]) => l);
  return found.length ? found.join(", ") : null;
}

function concessionNote(t) {
  const ages = concessionAges(t);
  return ages
    ? `Concessions at ${t.name} cover ${ages.toLowerCase()}. Take proof with you.`
    : `${t.name} has not published who qualifies for a concession. At this level it is usually over 65s and students, and often under 18s in full time education, but check on the gate.`;
}

/* ============================================================== the plan */

/**
 * One screen for one game: the matchday hub, and for an away game the away day
 * planner, which turned out to be the same screen with the travel section
 * filled in.
 *
 * Everything on it already existed somewhere: kick-off on the fixture list,
 * prices and parking and the pub in the away guide, the thread on the wall,
 * the prediction under the fixture. Spread across four screens it is a list of
 * facts; gathered on one it is a plan for a Saturday.
 */

/* Rough door to door. Non-league away trips are mostly A roads and ring roads,
   so 40mph is nearer the truth than a motorway average, and there is no point
   pretending this is a routing engine: it says roughly, and it says why. */
const travelMinutes = (miles) => Math.round((miles / 40) * 60);

function leaveBy(f) {
  const ko = kickoffTime(f);
  const miles = f.team?.distanceMiles;
  if (!ko || f.venue !== "Away" || typeof miles !== "number") return null;
  const drive = travelMinutes(miles);
  const beforeKo = 30;                    /* parking, turnstile, a pie */
  const out = new Date(ko.getTime() - (drive + beforeKo) * 60000);
  return { at: out, drive, miles };
}

/**
 * What we can tell somebody about leaving the car, in the order it is worth
 * hearing: what the club says, then what is physically there, then who to tell
 * if it is wrong.
 *
 * Fourteen of the twenty two clubs publish nothing about parking at all. That
 * used to mean an invented price range, then it meant a shrug. OpenStreetMap
 * knows where the car parks are even where the club will not say, and "three
 * public car parks within three hundred metres, nearest seventy" is a great
 * deal more use on a wet Tuesday than nothing.
 */
/**
 * The pub card, built the same way as parking and for the same reason.
 *
 * The one pub per ground that shipped with the app came off a spreadsheet, and
 * ten of the twenty one carried the ground's own postcode rather than the
 * pub's, so tapping for directions took you back to the turnstiles. Where the
 * postcode is the ground's it is not shown, because a wrong postcode is worse
 * than none.
 *
 * Underneath, what is actually near the ground. Whether away shirts get a
 * welcome is not in any map and only supporters can say, which is what the
 * board below it and the prompt after a game are for.
 */
/**
 * What a club normally draws, and what they drew when we came.
 *
 * The second number is the one supporters actually want. A club's average is a
 * fact about them; the gap between it and the day Kettering visited is a fact
 * about us, and it is the only stat on this site that answers "do we take a
 * decent following". It cuts both ways and is shown either way: three of the
 * grounds we went to last season were quieter with us there.
 */
/**
 * One line: what we did to their gate last time we went.
 *
 * The full card lives on the club page. This is the same fact reduced to a
 * sentence, for the places where a whole card would be in the way: the fixture
 * row, the matchday plan, the away guide. It only appears where we actually
 * lifted the crowd, which is not most of the point but is the version worth
 * putting in front of somebody deciding whether to travel.
 */
function followingLine(t) {
  const a = state.attendances?.clubs?.find((c) => c.slug === t?.id);
  if (!a || !a.sway || a.sway <= 5 || !a.ktfcAverage) return null;
  return el(`
    <p class="following">${ICON.poppy} Last season ${esc(t.name)} averaged ${
      a.average.toLocaleString("en-GB")}. <b>${a.ktfcAverage.toLocaleString("en-GB")} came when we
      did</b>, ${a.sway}% up on their normal gate.</p>`);
}

function gateCard(t) {
  const a = state.attendances?.clubs?.find((c) => c.slug === t.id);
  if (!a) return null;

  const card = el(`<div class="card"></div>`);
  card.append(el(`<div class="info__label">Their crowd, ${
    esc(state.attendances.season)}</div>`));

  if (a.elsewhere || !a.average) {
    card.append(el(`<p class="hint" style="margin:2px 0 0">${esc(t.name)} were in a different
      league last season, and the Southern League's figures do not cover it.</p>`));
    return card;
  }

  card.append(el(`<div class="info__value" style="color:var(--accent)">${
    a.average.toLocaleString("en-GB")}</div>`));
  card.append(el(`<div class="info__sub">on average across ${a.games} home league game${
    a.games === 1 ? "" : "s"}${a.division && a.division !== "Premier Central"
      ? `, in the ${esc(a.division)}` : ""}</div>`));

  if (a.ktfcAverage) {
    const up = a.sway > 0;
    card.append(el(`
      <div class="gate-swing${up ? " gate-swing--up" : ""}">
        <b>${a.ktfcAverage.toLocaleString("en-GB")}</b> when we visited
        <span>${up ? "+" : ""}${a.sway}%</span>
      </div>`));
  }

  card.append(el(`<p class="hint">Home league games only. Cups and play-offs are left out;
    neither is a normal Saturday.</p>`));
  return card;
}

function pubCard(t) {
  const near = state.pubsNearby?.clubs?.[t.id] || [];
  const anyName = state.pubsNearby?.verified?.[t.id]?.name
    || (t.pubPostcode && t.pubPostcode === t.postcode ? null : t.pub);
  if (!anyName && !near.length) return null;   // an empty Pub card helps nobody
  const card = el(`<div class="card"></div>`);
  card.append(el(`<div class="info__label">${ICON.pint} Pub</div>`));

  /* Where the spreadsheet and the map name the same pub, the map wins: Stamford
     had the Tobie Norris under two different postcodes, and only the mapped one
     is right. Naming it twice would be the smaller problem of the two. */
  const key = (n) => String(n).toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
  const shown = state.pubsNearby?.verified?.[t.id]?.name
    || (t.pubPostcode && t.pubPostcode === t.postcode ? null : t.pub);
  const alsoMapped = shown && near.some((p) => key(p.name) === key(shown));

  /* Ten grounds shipped with the ground's own postcode against the pub. Four of
     those pubs were confirmed by name on the map and are shown with the real
     one; the other six could not be found at all, and one of them was West
     Bromwich Albion's ground, so the name goes too. A pub nobody can find is
     not a recommendation. */
  const fabricated = t.pubPostcode && t.pubPostcode === t.postcode;
  const fixed = state.pubsNearby?.verified?.[t.id];
  const name = fabricated ? fixed?.name : t.pub;
  const code = fabricated ? fixed?.postcode : t.pubPostcode;

  if (name && !alsoMapped) {
    card.append(el(`<div class="info__value" style="margin-bottom:2px">${esc(name)}</div>`));
    if (code) {
      card.append(el(`<a class="map-link" href="${placeUrl(name, code)}" target="_blank"
        rel="noopener">${ICON.pin} ${esc(code)}</a>`));
    }
  }

  card.append(el(`<div class="hint">Worth a check before you set off. Away support is not always
    welcome everywhere.</div>`));

  if (near.length) {
    card.append(el(`<div class="park-near"></div>`));
    const list = $(".park-near", card);
    list.append(el(`<div class="park-near__head">${near.length} pub${
      near.length === 1 ? "" : "s"} near the ground</div>`));
    near.forEach((p) => {
      const meta = `${p.postcode ? `${esc(p.postcode)} &middot; ` : ""}${p.metres}m`;
      const label = `<span class="park-lot__name">${esc(p.name)}</span>
        <span class="park-lot__meta">${meta}</span>`;
      list.append(el(p.postcode
        ? `<a class="park-lot park-lot--link" href="${placeUrl(p.name, p.postcode)}"
             target="_blank" rel="noopener">${label}</a>`
        : `<div class="park-lot">${label}</div>`));
    });
    list.append(el(`<p class="park-near__src">From OpenStreetMap, nearest first, members' clubs
      left out. What is near the ground rather than a recommendation: whether away shirts get a
      welcome is the bit supporters have to tell each other.</p>`));
  }
  return card;
}

function parkingCard(t) {
  const park = state.parking?.clubs?.[t.id];
  const card = el(`<div class="card"></div>`);
  card.append(el(`<div class="info__label">${ICON.car} Parking</div>`));

  if (park?.text) {
    card.append(el(`<div class="info__value" style="margin-bottom:2px">${esc(park.price || "See below")}</div>`));
    card.append(el(`<div class="hint">${esc(park.text)}</div>`));
    if (park.source) {
      card.append(el(`<a class="map-link" href="${esc(park.source)}" target="_blank"
        rel="noopener">${ICON.globe} The club's own words</a>`));
    }
  } else {
    card.append(el(`<div class="info__value" style="margin-bottom:2px">Not published</div>`));
    card.append(el(`<div class="hint">${esc(t.name)} do not say anything about parking.</div>`));
  }

  const lots = park?.nearby || [];
  if (lots.length) {
    const near = lots.filter((l) => l.metres <= 300).length;
    card.append(el(`<div class="park-near"></div>`));
    const list = $(".park-near", card);
    list.append(el(`<div class="park-near__head">${lots.length} public car park${
      lots.length === 1 ? "" : "s"} mapped nearby${near ? `, ${near} within 300m` : ""}</div>`));
    lots.forEach((l) => {
      const bits = [];
      if (l.fee === "no") bits.push("free");
      else if (l.fee === "yes") bits.push("pay and display");
      if (l.capacity) bits.push(`${l.capacity} spaces`);
      if (l.postcode) bits.push(l.postcode);
      /* A postcode you cannot tap is half a postcode. Where there is one the
         row opens directions to it; where there is not, it stays plain text. */
      const label = `
        <span class="park-lot__name">${esc(l.name || "Car park")}</span>
        <span class="park-lot__meta">${bits.length ? `${esc(bits.join(" \u00B7 "))} &middot; ` : ""}${
          l.metres}m</span>`;
      list.append(el(l.postcode
        ? `<a class="park-lot park-lot--link" href="${placeUrl(l.name || "car park", l.postcode)}"
             target="_blank" rel="noopener">${label}</a>`
        : `<div class="park-lot">${label}</div>`));
    });
    list.append(el(`<p class="park-near__src">From OpenStreetMap, with street names and postcodes
      filled in from its geocoder where a car park was mapped without one. Few carry a price, so
      this is where they are rather than what they cost. Tap one for directions.</p>`));
  }

  /* What people who have actually been say, which beats both of the above. */
  const said = el(`<div></div>`);
  card.append(said);
  db.parkingSummary().then((all) => {
    const r = all?.[t.id];
    if (!r || !r.reports) return;
    const spot = (PARK_SPOTS.find(([k]) => k === r.usual_spot) || [, r.usual_spot])[1];
    const cost = r.free_reports === r.reports ? "free"
      : r.avg_cost != null ? `about ${money(Number(r.avg_cost).toFixed(2).replace(/\.00$/, ""))}`
      : "cost not given";
    said.append(el(`
      <div class="park-said">
        <b>${r.reports} supporter${r.reports === 1 ? "" : "s"} who went</b>
        <span>Mostly ${esc(String(spot).toLowerCase())}, ${esc(cost)}${
          r.avg_walk ? `, about ${r.avg_walk} minutes' walk` : ""}.</span>
      </div>`));
  }).catch(() => { /* nothing reported yet */ });

  return card;
}

function viewPlan({ id }) {
  const f = fixtures().find((x) => String(x.id) === String(id));
  const wrap = el(`<div></div>`);
  if (!f) {
    wrap.append(el(`<div class="empty"><b>No such game</b>It may have been rearranged.</div>`));
    return wrap;
  }

  const t = f.team;
  const away = f.venue === "Away";
  const ko = kickoffTime(f);
  const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  wrap.append(el(`
    <div class="page-head page-head--airy">
      <h1>${esc(clubName(f.opponent))}</h1>
      <p>${esc(fmtDate(f.date))} &middot; ${esc(f.kickoff || "")} &middot;
         ${away ? `away at ${esc(t?.stadium || `${clubName(f.opponent)}'s ground`)}` : "at Latimer Park"}${
           f.competition ? ` &middot; ${esc(f.competition)}` : ""}</p>
    </div>`));

  /* A reason to go, before the logistics of going. */
  if (away && t) { const fl = followingLine(t); if (fl) wrap.append(fl); }

  /* --- when to set off ---------------------------------------------- */
  const trip = leaveBy(f);
  if (trip) {
    wrap.append(el(`<h2 class="section-title">Getting there</h2>`));
    wrap.append(el(`
      <div class="card plan-leave">
        <div class="plan-leave__big">${esc(hhmm(trip.at))}</div>
        <div class="plan-leave__sub">is roughly when to leave Kettering</div>
        <p class="hint">${trip.miles} miles each way, about ${trip.drive} minutes on the road at
          A-road speeds, plus half an hour at the other end for parking and the turnstile. It is an
          estimate from the distance, not a route: check the traffic before you go.</p>
      </div>`));
  }

  /* A cup draw brings opponents from outside the division, and none of the
     away day detail exists for them: no ground, no postcode, no prices, no
     parking, no pub. Saying nothing at all is the wrong answer for the one
     game everybody travels to, so say what we do not know and point at
     something that does. */
  if (away && !t) {
    wrap.append(el(`<h2 class="section-title">Getting there</h2>`));
    const card = el(`
      <div class="card">
        <div class="info__label">Not one of ours</div>
        <p class="club-overview">${esc(clubName(f.opponent))} are not in our division, so we have
          no ground details, prices, parking or pub for them yet. If you are going and you find
          out, the away guide gets better for everybody next time.</p>
      </div>`);
    card.append(el(`<a class="map-link" target="_blank" rel="noopener"
      href="https://www.google.com/search?q=${encodeURIComponent(clubName(f.opponent) + " FC ground address")}"
      >${ICON.pin} Look up their ground</a>`));
    card.append(el(`<a class="map-link" target="_blank" rel="noopener"
      href="https://footballgroundguide.com/?s=${encodeURIComponent(clubName(f.opponent))}"
      >${ICON.pin} Football Ground Guide</a>`));
    wrap.append(card);
  }

  /* --- what it costs and where to leave the car ---------------------- */
  if (t) {
    wrap.append(el(`<h2 class="section-title">On the day</h2>`));
    const card = el(`
      <div class="card">
        <div class="info-grid info-grid--3">
          <div class="info"><div class="info__label">Adult</div>
            <div class="info__value" style="color:var(--accent)">${money(t.adultPrice)}</div></div>
          <div class="info"><div class="info__label">Concession</div>
            <div class="info__value">${money(t.concessionPrice)}</div></div>
          <div class="info"><div class="info__label">Capacity</div>
            <div class="info__value">${typeof t.capacity === "number"
              ? t.capacity.toLocaleString("en-GB") : esc(t.capacity)}</div></div>
        </div>
        ${t.ticketNotes ? `<p class="hint">${esc(t.ticketNotes)}</p>` : ""}
      </div>`);
    wrap.append(card);

    const bits = el(`<div class="grid grid--2"></div>`);
    bits.append(parkingCard(t));
    { const pc = pubCard(t); if (pc) bits.append(pc); }
    wrap.append(bits);

    const links = el(`<div class="btn-row" style="margin-top:12px"></div>`);
    links.append(el(`<a class="btn btn--sm" href="${directionsUrl(t)}" target="_blank"
      rel="noopener">${ICON.route} Directions</a>`));
    if (streetViewUrl(t)) {
      links.append(el(`<a class="btn btn--sm btn--ghost" href="${streetViewUrl(t)}" target="_blank"
        rel="noopener">${ICON.pin} Street View</a>`));
    }
    if (groundGuideUrl(t)) {
      links.append(el(`<a class="btn btn--sm btn--ghost" href="${esc(groundGuideUrl(t))}"
        target="_blank" rel="noopener">${ICON.globe} Ground guide</a>`));
    }
    const guide = el(`<button class="btn btn--sm btn--ghost">Full away guide</button>`);
    guide.addEventListener("click", () => go("club", { id: t.id, from: away ? "away" : "home" }));
    links.append(guide);
    wrap.append(links);
  }

  /* --- predict it, and talk about it -------------------------------- */
  if (f.status !== "played") {
    wrap.append(el(`<h2 class="section-title">Your prediction</h2>`));
    wrap.append(predictionCard(f));
  }

  const threads = threadsFor(f);
  if (threads.length) {
    wrap.append(el(`<h2 class="section-title">Talking about it</h2>`));
    const list = el(`<div class="card"></div>`);
    threads.forEach((th) => {
      const b = el(`
        <button class="talk-btn">
          <span>${esc(th.title)}</span>
          <span class="talk-btn__go" aria-hidden="true">\u203A</span>
        </button>`);
      b.addEventListener("click", () => go("thread", { id: th.id }));
      list.append(b);
    });
    wrap.append(list);
  }

  return wrap;
}

function viewClub({ id, from }) {
  /* Fetched once, then the page is redrawn so the price link can point at the
     page the figures actually came from. */
  if (!state.priceSourcePromise) {
    ensurePriceSources().then(() => { if (state.view === "club") render(); });
  }

  if (id === "kettering-town") return viewPoppies();
  const t = TEAMS.find((x) => x.id === id);
  if (!t) {
    return el(`<div><div class="empty"><b>Club not found</b>Head back to the away guide.</div></div>`);
  }

  const info = infoFor(t.id);
  const ours = fixtures().filter((f) => f.team?.id === t.id);
  const crest = ours.find((f) => f.opponentCrest)?.opponentCrest;
  const awayTrip = ours.find((f) => f.venue === "Away");

  /* Arriving from a home fixture means we are not going anywhere, so who they
     are matters and their car park does not. Lead with the background and let
     the travel detail sit further down. */
  const cameFromHome = from === "home";

  const wrap = el(`<div>
    <button class="back-link" data-nav="clubs">← Away guide</button>
    <div class="hub-hero">
      ${crest ? `<img class="hub-hero__crest" src="${esc(crest)}" alt="">` : ""}
      <div class="hub-hero__text">
        <h1>${esc(t.name)}</h1>
        <p>${esc(t.nickname)} · ${esc(t.stadium)}${info?.founded ? ` · Founded ${info.founded}` : ""}</p>
      </div>
    </div>
  </div>`);

  /* ---- the pieces ---- */

  const group = () => document.createDocumentFragment();

  const thisSeason = () => {
    if (!ours.length) return null;
    const box = group();
    box.append(el(`<h2 class="section-title">This season</h2>`));
    ours.forEach((f) => box.append(fixtureCard(f)));
    return box;
  };

  const about = () => {
    if (!t.fact && !info?.summary && !info?.website) return null;
    const box = group();
    box.append(el(`<h2 class="section-title">About ${esc(t.name)}</h2>`));
    const card = el(`<div class="card"></div>`);
    if (t.fact) card.append(el(`<div class="club-fact">${ICON.info} ${esc(t.fact)}</div>`));
    const ours = overviewFor(t.id);
    if (ours) {
      card.append(el(`<p class="club-overview">${esc(ours.text)}</p>`));
    }

    /* The Wikipedia text is thorough but reads like a reference book, so it
       sits underneath for anyone who wants the full history. */
    if (info?.summary) {
      if (ours) {
        const more = el(`<details class="club-history"><summary>More history</summary></details>`);
        more.append(el(`<div class="info__value info__value--body">${esc(info.summary)}</div>`));
        card.append(more);
      } else {
        card.append(el(`<div class="info__value info__value--body" style="margin-top:${t.fact ? 12 : 0}px">${esc(info.summary)}</div>`));
      }
    }
    const links = [];
    if (info?.website) links.push(`<a class="btn btn--sm btn--ghost" href="${esc(info.website)}" target="_blank" rel="noopener">${ICON.globe} Official website</a>`);
    if (info?.wikipedia) links.push(`<a class="btn btn--sm btn--ghost" href="${esc(info.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (links.length) card.append(el(`<div class="btn-row" style="margin-top:14px">${links.join("")}</div>`));
    box.append(card);
    return box;
  };

  const travelNote = () => el(`
    <div class="notice notice--info">
      ${cameFromHome
        ? `${esc(t.name)} come to ${esc(KTFC.ground)} this season. The travel, parking and
           pub details further down are for <b>our trip to ${esc(t.stadium)}</b>${
             awayTrip ? ` on ${esc(fmtDate(awayTrip.date, "short"))}` : ""
           }.`
        : awayTrip
        ? `The travel, parking and pub details below are for <b>our trip to ${esc(t.stadium)}</b>
           on ${esc(fmtDate(awayTrip.date, "short"))}. It is ${t.distanceMiles} miles each way from ${esc(KTFC.ground)}.`
        : `The travel details below are for visiting <b>${esc(t.stadium)}</b>, ${t.distanceMiles} miles from ${esc(KTFC.ground)}.`}
    </div>`);

  const ground = () => {
    const box = group();
    { const fl = followingLine(t); if (fl) box.append(fl); }
    box.append(el(`<h2 class="section-title">Their ground</h2>`));
    box.append(el(`
      <div class="card">
        <div class="info-grid info-grid--4">
          <div class="info"><div class="info__label">Ground</div><div class="info__value">${esc(t.stadium)}</div></div>
          <div class="info"><div class="info__label">Capacity</div><div class="info__value">${
            typeof t.capacity === "number" ? t.capacity.toLocaleString("en-GB") : esc(t.capacity)
          }</div></div>
          <div class="info"><div class="info__label">Distance</div><div class="info__value">${t.distanceMiles} miles</div></div>
          <div class="info"><div class="info__label">Postcode</div><div class="info__value">${esc(t.postcode)}</div></div>
        </div>
        <div class="map-actions">
          <a class="btn btn--map" href="${directionsUrl(t)}" target="_blank" rel="noopener">${ICON.route} Directions</a>
          <a class="btn btn--map btn--ghost" href="${mapUrl(t)}" target="_blank" rel="noopener">${ICON.pin} Open in Maps</a>
          ${streetViewUrl(t)
            ? `<a class="btn btn--map btn--ghost" href="${streetViewUrl(t)}" target="_blank"
                  rel="noopener">${ICON.pin} Street View</a>` : ""}
          ${groundGuideUrl(t)
            ? `<a class="btn btn--map btn--ghost" href="${esc(groundGuideUrl(t))}" target="_blank"
                  rel="noopener">${ICON.globe} Ground guide</a>` : ""}
        </div>
      </div>`));

    /* Under the ground card, because a crowd belongs beside the size of the
       place that holds it. */
    { const g = gateCard(t); if (g) box.append(g); }
    const ask = groundPrompt(t, awayTrip) || parkingPrompt(t, awayTrip) || pubPrompt(t, awayTrip);
    if (ask) box.append(ask);
    box.append(groundNotes(t));
    return box;
  };

  const tickets = () => {
    const box = group();
    box.append(el(`<h2 class="section-title">On the gate</h2>`));
    box.append(el(`
      <div class="card">
        <div class="info-grid info-grid--4">
          <div class="info"><div class="info__label">Adult</div><div class="info__value" style="color:var(--accent)">${money(t.adultPrice)}</div></div>
          <div class="info"><div class="info__label">Concession${concessionAges(t) ? ` · ${esc(concessionAges(t))}` : ""}</div><div class="info__value">${money(t.concessionPrice)}</div></div>
          <div class="info"><div class="info__label">Youth · ${esc(t.youthRange)}</div><div class="info__value">${money(t.youthPrice)}</div></div>
          <div class="info"><div class="info__label">Child · ${esc(t.childRange)}</div><div class="info__value">${money(t.childPrice)}</div></div>
        </div>
        ${t.ticketNotes ? `<div class="hint" style="margin-top:10px">${esc(t.ticketNotes)}</div>` : ""}
        <div class="hint">${esc(concessionNote(t))}</div>
        <div class="hint">${
          t.priceChecked && t.priceSeason
            ? `The latest ${esc(t.priceSeason)} prices ${esc(t.priceSource || "the club")} has published, read on ${esc(fmtDate(t.priceChecked, "short"))}. They may have gone up since, so take a little extra.`
            : t.priceChecked
            ? `Checked against ${esc(t.priceSource || "the club's own site")} on ${esc(fmtDate(t.priceChecked, "short"))}.`
            : "Not independently checked. Most clubs at this level do not publish prices anywhere we can read, so treat this as a guide and have a little extra with you."
        }</div>
        ${(() => {
          const exact = state.priceSources?.[t.id];
          const href = exact || info?.website;
          if (!href) return "";
          return `<div class="btn-row" style="margin-top:10px">
               <a class="btn btn--sm btn--ghost" href="${esc(href)}" target="_blank" rel="noopener">${ICON.globe} ${
                 exact ? "See their ticket prices" : `Check on the ${esc(t.name)} site`}</a>
             </div>`;
        })()}
      </div>`));

    /* What supporters say they actually paid, which beats anything published. */
    const paid = db.pricesFor(t.id);
    if (paid.length) {
      const card = el(`<div class="card"><div class="events__head">What supporters paid</div></div>`);
      paid.slice(0, 4).forEach((r) => {
        card.append(el(`
          <div class="event">
            <span class="event__icon" aria-hidden="true">\u{1F39F}\u{FE0F}</span>
            <span class="event__name event--ours">${
              [r.adult ? `Adult ${money(Number(r.adult))}` : "",
               r.concession ? `Concession ${money(Number(r.concession))}` : ""].filter(Boolean).join(" \u00B7 ")
            }<span class="event__note">${esc(r.author_name)}${r.paid_on ? `, ${esc(fmtDate(r.paid_on, "short"))}` : ""}</span></span>
          </div>`));
        if (r.notes) card.append(el(`<p class="hint" style="margin:0 0 6px 29px">${esc(r.notes)}</p>`));
      });
      box.append(card);
    }

    const report = el(`<button class="link-btn price-report" type="button">Paid something different? Put us right</button>`);
    report.addEventListener("click", () => priceModal(t));
    box.append(report);
    return box;
  };

  const parkingAndPub = () => {
    const box = group();
    box.append(el(`<h2 class="section-title">Parking and the pub at ${esc(t.stadium)}</h2>`));
    /* One parking card, shared with the matchday plan, so the away guide and
       the plan cannot drift apart on the same question. */
    const pair = el(`<div class="grid grid--2"></div>`);
    pair.append(parkingCard(t));
    { const pc = pubCard(t); if (pc) pair.append(pc); }
    box.append(pair);
    box.append(el(`<h2 class="section-title">Supporter recommendations</h2>`));
    box.append(pubBoard(t));
    return box;
  };

  const access = () => {
    const box = group();
    box.append(el(`<h2 class="section-title">Getting in: access</h2>`));
    box.append(accessBoard(t));
    return box;
  };

  /* ---- the running order ---- */

  /* Coming from a home game, everything about their ground is for a trip we
     are not making yet, and supporters told us it read as if we were. So it
     folds away behind one switch instead of disappearing: the detail is still
     a tap away when the away game comes round. The choice is remembered. */
  const awayParts = [travelNote, ground, tickets, access, parkingAndPub];

  if (!cameFromHome) {
    [travelNote, thisSeason, ground, tickets, access, parkingAndPub, about].forEach((section) => {
      const node = section();
      if (node) wrap.append(node);
    });
    return wrap;
  }

  [thisSeason, about].forEach((section) => {
    const node = section();
    if (node) wrap.append(node);
  });

  const holder = el(`<div></div>`);
  const toggle = el(`
    <button class="away-toggle" type="button" aria-expanded="false">
      <span class="away-toggle__text">
        <b>Their ground and away day details</b>
        <span>Tickets, parking and the pub for when we travel to ${esc(t.stadium)}${
          awayTrip ? ` on ${esc(fmtDate(awayTrip.date, "short"))}` : ""
        }.</span>
      </span>
      <span class="away-toggle__chevron" aria-hidden="true">›</span>
    </button>`);

  /* Starts shut every time, not just the first time. Someone who opened it once
     for one club should not find the next home tie already unfolded. */
  let open = false;

  const paint = () => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
    holder.replaceChildren();
    if (!open) return;
    awayParts.forEach((section) => {
      const node = section();
      if (node) holder.append(node);
    });
  };

  toggle.addEventListener("click", () => {
    open = !open;
    paint();
  });

  wrap.append(toggle, holder);
  paint();
  return wrap;
}

/* ------------------------------------------------------------ ground notes */

/* The practical things nobody publishes for our level: can you stay dry, do
   they take a card, is there a cup of tea. Same shape as the access board,
   because the same problem applies. */

const GROUND_FIELDS = [
  ["covered", "Covered standing", { yes: "Yes", no: "None" }],
  ["seating", "Seating", { yes: "Yes", no: "Standing only" }],
  ["refreshments", "Food and drink", { yes: "Yes", no: "None" }],
  ["bar", "Bar at the ground", { yes: "Yes", no: "None" }],
  ["card_payments", "Card accepted", { yes: "Yes", no: "Cash only" }],
  ["dogs", "Dogs welcome", { yes: "Yes", no: "No" }],
];

const SURFACE_LABEL = { grass: "Grass", "3g": "3G", unsure: "Not known" };

function groundNotes(team) {
  const box = el(`<div></div>`);
  const user = db.currentUser();

  if (!db.isOnline()) return box; /* nothing to add without accounts */

  const reports = db.groundFor(team.id);

  /* One "no" is worth knowing, so it outranks a "yes"; disagreement is shown
     rather than resolved. */
  const agree = (key, allowed) => {
    const said = reports.map((r) => r[key]).filter((v) => v && v !== "unsure" && allowed.includes(v));
    if (!said.length) return "unsure";
    return said.every((v) => v === said[0]) ? said[0] : "mixed";
  };

  const surface = agree("surface", ["grass", "3g"]);

  const rows = GROUND_FIELDS.map(([key, label, words]) => {
    const v = agree(key, ["yes", "no"]);
    const m = v === "yes" ? ACCESS_MARK.yes : v === "no" ? ACCESS_MARK.no
      : v === "mixed" ? ACCESS_MARK.mixed : ACCESS_MARK.unsure;
    const text = v === "yes" ? words.yes : v === "no" ? words.no : m.label;
    return `<li class="access-row">
      <span class="access-mark access-mark--${m.cls}" aria-hidden="true">${m.icon}</span>
      <span class="access-label">${esc(label)}</span>
      <span class="access-value access-value--${m.cls}">${esc(text)}</span>
    </li>`;
  }).join("");

  const surfaceMark = surface === "unsure" ? ACCESS_MARK.unsure
    : surface === "mixed" ? ACCESS_MARK.mixed : ACCESS_MARK.yes;

  box.append(el(`
    <div class="card">
      <ul class="access-list">
        <li class="access-row">
          <span class="access-mark access-mark--${surfaceMark.cls}" aria-hidden="true">${surfaceMark.icon}</span>
          <span class="access-label">Pitch</span>
          <span class="access-value access-value--${surfaceMark.cls}">${
            surface === "mixed" ? "Reports differ" : esc(SURFACE_LABEL[surface] || "Not known")
          }</span>
        </li>
        ${rows}
      </ul>
      <div class="hint">
        ${reports.length
          ? `From ${reports.length} supporter${reports.length === 1 ? "" : "s"} who have been. Grounds change, so give the club a ring if it matters.`
          : `Nobody has filled this in for ${esc(team.stadium)} yet. If you have been, a minute of your time saves somebody a wet afternoon.`}
      </div>
    </div>`));

  if (user) {
    const btn = el(`<div class="btn-row--actions"><button class="btn btn--ghost">Add what you know</button></div>`);
    btn.querySelector("button").addEventListener("click", () => groundForm(team));
    box.append(btn);
  }

  reports.filter((r) => r.notes).slice(0, 3).forEach((r) => {
    const note = el(`
      <div class="post">
        <div class="post__head">
          <span class="post__who">${esc(r.author_name)}</span>
          ${r.visited_on ? `<span class="pill pill--muted">Visited ${esc(fmtDate(r.visited_on, "short"))}</span>` : ""}
          <span class="post__when">${esc(relTime(new Date(r.created_at).getTime()))}</span>
        </div>
        <div class="post__body">${esc(r.notes)}</div>
      </div>`);
    if (r.profile_id === user?.id || db.isAdmin()) {
      const act = el(`<div class="post__actions"><button class="link-btn">Remove</button></div>`);
      act.querySelector("button").addEventListener("click", () => {
        db.removeGroundReport(r.id);
        toast("Note removed.", "good");
      });
      note.append(act);
    }
    box.append(note);
  });

  return box;
}

function groundForm(team) {
  const pick = (key, label, words) => `
    <div class="field">
      <label for="gr-${key}">${esc(label)}</label>
      <select id="gr-${key}">
        <option value="unsure">Not sure</option>
        <option value="yes">${esc(words.yes)}</option>
        <option value="no">${esc(words.no)}</option>
      </select>
    </div>`;

  const { node, close } = modal(`
    <h2>${esc(team.stadium)}</h2>
    <p class="sub">What is it actually like to visit? Answer what you know and leave the rest.</p>
    <div class="field">
      <label for="gr-surface">Pitch</label>
      <select id="gr-surface">
        <option value="unsure">Not sure</option>
        <option value="grass">Grass</option>
        <option value="3g">3G</option>
      </select>
    </div>
    ${GROUND_FIELDS.map(([k, l, w]) => pick(k, l, w)).join("")}
    <div class="field"><label for="gr-when">When did you visit</label>
      <input id="gr-when" type="date"></div>
    <div class="field"><label for="gr-notes">Anything else worth knowing</label>
      <textarea id="gr-notes" maxlength="500" placeholder="Cover behind both goals, nothing down the sides. Tea bar does a decent burger."></textarea></div>
    <div class="btn-row">
      <button class="btn btn--full" id="gr-save">Send</button>
      <button class="btn btn--ghost" id="gr-cancel">Cancel</button>
    </div>`);

  $("#gr-cancel", node).addEventListener("click", close);
  $("#gr-save", node).addEventListener("click", () => {
    const report = Object.fromEntries(GROUND_FIELDS.map(([k]) => [k, $(`#gr-${k}`, node).value]));
    report.surface = $("#gr-surface", node).value;
    const notes = $("#gr-notes", node).value.trim();
    const when = $("#gr-when", node).value;

    if (!Object.values(report).some((v) => v !== "unsure") && !notes) {
      return toast("Answer at least one, or add a note.", "bad");
    }
    if (notes) {
      const check = db.checkPost(notes, { minLength: 0, maxLength: 500 });
      if (!check.ok) return toast(check.reason, "bad");
    }
    const limit = db.rateLimit("ground", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason, "bad");

    db.addGroundReport(team.id, { ...report, notes: notes || null, visited_on: when || null });
    close();
    toast("Thanks, that is genuinely useful.", "good");
  });
}

/* ----------------------------------------------------- putting prices right */

/* The supporter who has just been through the turnstile knows the real price,
   which is more than can be said for most club websites. */
function priceModal(team) {
  if (!db.currentUser()) {
    toast("You need an account to report a price.", "bad");
    return;
  }
  const { node, close } = modal(`
    <h2>What did you pay at ${esc(team.stadium)}?</h2>
    <p class="sub">Only fill in what you know. It helps everyone travelling after you.</p>
    <div class="grid grid--2">
      <div class="field"><label for="pr-adult">Adult</label>
        <input id="pr-adult" type="number" min="0" max="60" step="0.5" inputmode="decimal" placeholder="e.g. 13"></div>
      <div class="field"><label for="pr-conc">Concession</label>
        <input id="pr-conc" type="number" min="0" max="60" step="0.5" inputmode="decimal" placeholder="e.g. 9"></div>
    </div>
    <div class="field"><label for="pr-when">When you went</label>
      <input id="pr-when" type="date"></div>
    <div class="field"><label for="pr-notes">Anything worth adding</label>
      <input id="pr-notes" maxlength="300" placeholder="Cash only, cheaper online, that sort of thing"></div>
    <div class="btn-row">
      <button class="btn btn--full" id="pr-go">Send it in</button>
      <button class="btn btn--ghost" id="pr-cancel">Cancel</button>
    </div>`);

  $("#pr-cancel", node).addEventListener("click", close);
  $("#pr-go", node).addEventListener("click", () => {
    const num = (id) => {
      const raw = $(id, node).value.trim();
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 60 ? n : NaN;
    };
    const adult = num("#pr-adult");
    const concession = num("#pr-conc");
    if (Number.isNaN(adult) || Number.isNaN(concession)) {
      return toast("Those prices do not look right.", "bad");
    }
    if (adult === null && concession === null) {
      return toast("Put in at least one price.", "bad");
    }
    const notes = $("#pr-notes", node).value.trim();
    if (notes) {
      const check = db.checkPost(notes, { minLength: 0, maxLength: 300 });
      if (!check.ok) return toast(check.reason, "bad");
    }
    const limit = db.rateLimit("price", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason, "bad");

    db.addPriceReport(team.id, {
      adult, concession,
      paid_on: $("#pr-when", node).value || null,
      notes: notes || null,
    });
    close();
    toast("Thanks, that is genuinely useful.", "good");
  });
}

/* --------------------------------------------------- asking people who went */

/* The boards were barely used: four ground reports and no pubs across the whole
   division. The information has no other source at this level, so the problem
   was never the form, it was that nobody was ever asked. This asks the people
   who were actually there, one question at a time, about the things still
   unknown for that ground. */

/** Fields nobody has answered yet for a club, hardest gaps first. */
function unknownGroundFields(clubSlug) {
  const reports = db.groundFor(clubSlug);
  return GROUND_FIELDS.filter(([key]) =>
    !reports.some((r) => r[key] && r[key] !== "unsure"));
}

const PARK_SPOTS = [
  ["ground", "At the ground"],
  ["street", "On the street nearby"],
  ["town", "A car park in town"],
  ["pub", "At a pub"],
  ["other", "Somewhere else"],
];
const PARK_COSTS = [
  [0, "Free"], [2, "About £2"], [3, "About £3"], [5, "About £5"], [null, "Cannot remember"],
];

/**
 * Two taps from somebody who has just been.
 *
 * The map can say a car park exists. It cannot say that it fills by half two,
 * that the stewards wave you round the back, or that the machine takes cards.
 * The people who know that were there on Saturday, and the app already knows
 * who they are because they marked themselves as having gone.
 *
 * Only asked where it is worth asking: an away ground whose club publishes
 * nothing. Turned down once is an answer, and it is not raised again.
 */
function parkingPrompt(team, fixture) {
  if (!db.currentUser() || !team) return null;
  if (fixture && fixture.venue !== "Away") return null;
  if (state.parking?.clubs?.[team.id]?.text) return null;      /* the club has said */
  if (db.read(`parkAsked:${team.id}`, false)) return null;

  const answers = {};
  const box = el(`<div class="card ask"></div>`);

  const done = (msg) => box.replaceChildren(el(`<p class="ask__done">${esc(msg)}</p>`));

  const askCost = () => {
    box.replaceChildren();
    box.append(el(`
      <div class="ask__head">
        <b>And what did it cost?</b>
        <span>Roughly is fine.</span>
      </div>`));
    const row = el(`<div class="chips__row"></div>`);
    PARK_COSTS.forEach(([v, label]) => {
      const b = el(`<button class="chip">${esc(label)}</button>`);
      b.addEventListener("click", () => {
        db.addParkingReport(team.id, {
          spot: answers.spot, cost: v, walkMin: null, notes: null,
          visitedOn: fixture?.date || null,
        });
        db.write(`parkAsked:${team.id}`, true);
        done("Thanks. That is the bit nobody else can tell the next lot going.");
      });
      row.append(b);
    });
    box.append(row);
  };

  box.append(el(`
    <div class="ask__head">
      <b>Where did you park?</b>
      <span>You were at ${esc(team.stadium)}, and ${esc(team.name)} do not publish anything about
        parking. Two taps and the next supporter going knows.</span>
    </div>`));
  const spots = el(`<div class="chips__row"></div>`);
  PARK_SPOTS.forEach(([v, label]) => {
    const b = el(`<button class="chip">${esc(label)}</button>`);
    b.addEventListener("click", () => { answers.spot = v; askCost(); });
    spots.append(b);
  });
  box.append(spots);

  const no = el(`<button class="link-btn" style="margin-top:10px">Not now</button>`);
  no.addEventListener("click", () => {
    db.write(`parkAsked:${team.id}`, true);
    done("No bother. You will not be asked about this ground again.");
  });
  box.append(no);
  return box;
}

/**
 * A short prompt for a supporter who attended. Asks up to three of the open
 * questions, one at a time, then files them as a single report. Answering is
 * optional throughout and nothing blocks the page.
 */
function groundPrompt(team, fixture) {
  if (!db.currentUser()) return null;
  /* One question, not a queue of them. Anyone who wants to add more can use
     the full form underneath. */
  const open = unknownGroundFields(team.id).slice(0, 1);
  if (!open.length) return null;

  /* Turned down once is an answer. Do not raise the same ground again. */
  if (db.read(`askedOff:${team.id}`, false)) return null;

  const answers = {};
  let i = 0;

  const box = el(`<div class="card ask"></div>`);

  const finish = () => {
    const report = Object.fromEntries(GROUND_FIELDS.map(([k]) => [k, answers[k] || "unsure"]));
    report.surface = "unsure";
    if (Object.values(report).every((v) => v === "unsure")) {
      box.replaceChildren(el(`<p class="ask__done">No bother. It is on the club page if you change your mind.</p>`));
      return;
    }
    db.addGroundReport(team.id, {
      ...report,
      notes: null,
      visited_on: fixture?.date || null,
    });
    box.replaceChildren(el(`<p class="ask__done">Thanks, that is genuinely useful to the next lot going.</p>`));
  };

  const paint = () => {
    if (i >= open.length) return finish();
    const [key, label, words] = open[i];
    box.replaceChildren();
    box.append(el(`
      <div class="ask__head">
        <b>One question, if you have a second</b>
        <span>You were at ${esc(team.stadium)}. Anything you know helps the next supporters going, and it is always appreciated. Ignore this if you would rather not.</span>
      </div>
      <div class="ask__q">${esc(label)}?</div>`));

    const row = el(`<div class="ask__row"></div>`);
    [["yes", words.yes], ["no", words.no], ["unsure", "Not sure"]].forEach(([value, text]) => {
      const b = el(`<button class="btn btn--sm${value === "unsure" ? " btn--ghost" : ""}" type="button">${esc(text)}</button>`);
      b.addEventListener("click", () => {
        answers[key] = value;
        i += 1;
        paint();
      });
      row.append(b);
    });
    box.append(row);

    const skip = el(`<button class="link-btn ask__skip" type="button">Not now</button>`);
    skip.addEventListener("click", () => {
      db.write(`askedOff:${team.id}`, true);
      box.replaceChildren(el(`<p class="ask__done">No bother at all. It is on the club page if you ever fancy it.</p>`));
    });
    box.append(skip);
  };

  paint();
  return box;
}

/* ------------------------------------------------------------ access board */

/* Nobody publishes this for Step 3. OpenStreetMap had three tags across the
   whole division and the club sites say nothing usable, so it comes from
   supporters who have been. Where nobody has reported, the app says so rather
   than implying a ground is inaccessible. */

const ACCESS_FIELDS = [
  ["step_free", "Step-free to a viewing area"],
  ["wheelchair_spaces", "Designated wheelchair spaces"],
  ["accessible_toilet", "Accessible toilet"],
  ["blue_badge_parking", "Blue badge parking"],
  ["carer_free", "Carer goes free or reduced"],
];

/** Combine reports: a single "no" is worth knowing, so it wins over a "yes". */
function accessSummary(reports) {
  const out = {};
  ACCESS_FIELDS.forEach(([key]) => {
    const said = reports.map((r) => r[key]).filter((v) => v && v !== "unsure");
    if (!said.length) out[key] = "unsure";
    else if (said.includes("no") && said.includes("yes")) out[key] = "mixed";
    else out[key] = said[0];
  });
  return out;
}

const ACCESS_MARK = {
  yes: { icon: "✓", cls: "ok", label: "Yes" },
  no: { icon: "✕", cls: "no", label: "No" },
  mixed: { icon: "~", cls: "mixed", label: "Reports differ" },
  unsure: { icon: "?", cls: "unsure", label: "Not known" },
};

function accessBoard(team) {
  const box = el(`<div></div>`);
  const user = db.currentUser();

  if (!db.isOnline()) {
    box.append(el(`<div class="notice notice--info">Access reports need the online setup. Please ring ${esc(team.name)} before travelling.</div>`));
    return box;
  }

  const reports = db.accessFor(team.id);
  const summary = accessSummary(reports);
  const anything = reports.length > 0;

  const card = el(`
    <div class="card">
      <ul class="access-list">
        ${ACCESS_FIELDS.map(([key, label]) => {
          const m = ACCESS_MARK[summary[key]];
          return `<li class="access-row">
            <span class="access-mark access-mark--${m.cls}" aria-hidden="true">${m.icon}</span>
            <span class="access-label">${esc(label)}</span>
            <span class="access-value access-value--${m.cls}">${esc(m.label)}</span>
          </li>`;
        }).join("")}
      </ul>
      <div class="hint">
        ${anything
          ? `Based on ${reports.length} report${reports.length === 1 ? "" : "s"} from supporters who have been. Always ring the club to confirm before you travel.`
          : `Nobody has reported on access at ${esc(team.stadium)} yet. That does not mean it is poor, only that we do not know. If you have been, please tell the next person.`}
      </div>
    </div>`);
  box.append(card);

  if (user) {
    const btn = el(`<div class="btn-row--actions"><button class="btn btn--ghost">Report on access here</button></div>`);
    btn.querySelector("button").addEventListener("click", () => accessForm(team));
    box.append(btn);
  } else {
    box.append(el(`<div class="notice notice--info">Sign in to add what you know about access at ${esc(team.stadium)}.</div>`));
  }

  reports.filter((r) => r.notes).slice(0, 4).forEach((r) => {
    const note = el(`
      <div class="post">
        <div class="post__head">
          <span class="post__who">${esc(r.author_name)}</span>
          ${r.visited_on ? `<span class="pill pill--muted">Visited ${esc(fmtDate(r.visited_on, "short"))}</span>` : ""}
          <span class="post__when">${esc(relTime(new Date(r.created_at).getTime()))}</span>
        </div>
        <div class="post__body">${esc(r.notes)}</div>
      </div>`);
    if (r.profile_id === user?.id || db.isAdmin()) {
      const act = el(`<div class="post__actions"><button class="link-btn">Remove</button></div>`);
      act.querySelector("button").addEventListener("click", () => {
        db.removeAccessReport(r.id);
        toast("Report removed.", "good");
      });
      note.append(act);
    }
    box.append(note);
  });

  return box;
}

function accessForm(team) {
  const choices = (key) => `
    <div class="field">
      <label for="ac-${key}">${esc(ACCESS_FIELDS.find(([k]) => k === key)[1])}</label>
      <select id="ac-${key}">
        <option value="unsure">Not sure</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>`;

  const { node, close } = modal(`
    <h2>Access at ${esc(team.stadium)}</h2>
    <p class="sub">Only answer what you actually know. "Not sure" is a proper answer and more use than a guess.</p>
    ${ACCESS_FIELDS.map(([k]) => choices(k)).join("")}
    <div class="field"><label for="ac-when">When did you visit</label>
      <input id="ac-when" type="date"></div>
    <div class="field"><label for="ac-notes">Anything else worth knowing</label>
      <textarea id="ac-notes" maxlength="500" placeholder="Hard standing along one side, and the club will open the gate if you ring ahead."></textarea></div>
    <div class="btn-row">
      <button class="btn btn--full" id="ac-save">Send report</button>
      <button class="btn btn--ghost" id="ac-cancel">Cancel</button>
    </div>`);

  $("#ac-cancel", node).addEventListener("click", close);
  $("#ac-save", node).addEventListener("click", () => {
    const report = Object.fromEntries(ACCESS_FIELDS.map(([k]) => [k, $(`#ac-${k}`, node).value]));
    const notes = $("#ac-notes", node).value.trim();
    const when = $("#ac-when", node).value;

    const saidSomething = Object.values(report).some((v) => v !== "unsure") || notes;
    if (!saidSomething) return toast("Answer at least one question, or add a note.", "bad");

    if (notes) {
      const check = db.checkPost(notes, { minLength: 0, maxLength: 500 });
      if (!check.ok) return toast(check.reason, "bad");
    }
    const limit = db.rateLimit("access", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason, "bad");

    db.addAccessReport(team.id, { ...report, notes: notes || null, visited_on: when || null });
    close();
    toast("Thank you, that will help somebody.", "good");
  });
}

/* --------------------------------------------------- supporter pub board */

/* Short enough for a pill. The full wording is on the form where somebody is
   choosing; here it only has to be recognisable at a glance. */
const PUB_WELCOME = { yes: "Away fans welcome", mixed: "Keep it quiet", no: "Home fans only" };

/**
 * Asks somebody who has just been where they drank.
 *
 * Same reasoning as the parking prompt: the board fills up with suggestions
 * from people planning a trip, which is the wrong end of it. The useful
 * verdict comes from somebody who walked in wearing a Kettering shirt on
 * Saturday, and the app knows who did.
 */
function pubPrompt(team, fixture) {
  if (!db.currentUser() || !team) return null;
  if (fixture && fixture.venue !== "Away") return null;
  if (db.read(`pubAsked:${team.id}`, false)) return null;

  const box = el(`<div class="card ask"></div>`);
  const done = (msg) => box.replaceChildren(el(`<p class="ask__done">${esc(msg)}</p>`));
  const stop = () => db.write(`pubAsked:${team.id}`, true);

  const known = db.pubsFor(team.id);

  box.append(el(`
    <div class="ask__head">
      <b>Did you go anywhere for a pint?</b>
      <span>Near ${esc(team.stadium)}. Whether away shirts got a welcome is the bit nobody can
        find out from a website.</span>
    </div>`));

  const row = el(`<div class="chips__row"></div>`);
  known.slice(0, 4).forEach((pub) => {
    const b = el(`<button class="chip">${esc(pub.name)}</button>`);
    b.addEventListener("click", () => {
      /* Already on the board, so this is a vote for it rather than a duplicate. */
      if (!db.votedForPub(pub.id)) db.votePub(pub.id);
      stop();
      done(`Noted, that is a vote for ${pub.name}.`);
    });
    row.append(b);
  });
  const other = el(`<button class="chip">${known.length ? "Somewhere else" : "Add the place"}</button>`);
  other.addEventListener("click", () => { stop(); box.remove(); pubForm(team); });
  row.append(other);
  box.append(row);

  const no = el(`<button class="link-btn" style="margin-top:10px">Not this time</button>`);
  no.addEventListener("click", () => { stop(); done("No bother."); });
  box.append(no);
  return box;
}

function pubBoard(team) {
  const box = el(`<div></div>`);
  const user = db.currentUser();

  const btn = el(`<button class="btn btn--sm btn--ghost" style="margin-bottom:10px">${ICON.pint} Suggest a pub</button>`);
  btn.addEventListener("click", () => pubForm(team));
  box.append(btn);

  if (!db.isOnline()) {
    box.append(el(`<div class="notice notice--info">
      Your suggestions are saved on this device for now. They will be shared with
      other supporters once the online setup is finished.
    </div>`));
  }

  const pubs = db.pubsFor(team.id);
  if (!pubs.length) {
    box.append(el(`<div class="empty"><b>No suggestions yet</b>Know somewhere better? Add it for the next lot travelling.</div>`));
    return box;
  }

  pubs.forEach((p) => {
    const voted = db.votedForPub(p.id);
    const card = el(`
      <div class="post">
        <div class="post__head">
          <span class="post__who">${esc(p.name)}</span>
          ${p.away_friendly ? `<span class="pill ${
            p.away_friendly === "yes" ? "pill--ok" : p.away_friendly === "no" ? "pill--stop" : "pill--muted"
          }">${esc(PUB_WELCOME[p.away_friendly] || "")}</span>` : ""}
          ${p.postcode ? `<span class="pill pill--muted">${esc(p.postcode)}</span>` : ""}
          <span class="post__when">${esc(p.author_name)}</span>
        </div>
        ${p.notes ? `<div class="post__body">${esc(p.notes)}</div>` : ""}
        <div class="post__actions">
          <button class="link-btn" data-act="vote">${voted ? "★" : "☆"} ${p.votes || 0}</button>
          <a class="map-link" style="margin:0" href="${placeUrl(p.name, p.postcode)}"
             target="_blank" rel="noopener">${ICON.pin} Map</a>
          <a class="map-link" style="margin:0" href="${placeUrl(p.name, p.postcode)}&dirflg=d"
             target="_blank" rel="noopener">${ICON.route} Directions</a>
          ${p.profile_id === user?.id || db.isAdmin() ? `<button class="link-btn" data-act="del">Remove</button>` : ""}
        </div>
      </div>`);

    card.querySelector('[data-act="vote"]').addEventListener("click", () => db.votePub(p.id));
    card.querySelector('[data-act="del"]')?.addEventListener("click", () => {
      db.removePub(p.id);
      toast("Recommendation removed.");
    });
    box.append(card);
  });

  return box;
}

function pubForm(team) {
  const { node, close } = modal(`
    <h2>Suggest a pub</h2>
    <p class="sub">Somewhere near ${esc(team.stadium)} that away fans are welcome.</p>
    <div class="field"><label for="pb-name">Name</label>
      <input id="pb-name" maxlength="80" placeholder="The Red Lion"></div>
    <div class="field"><label for="pb-pc">Postcode</label>
      <input id="pb-pc" maxlength="12" placeholder="B48 7LG"></div>
    <div class="field"><label for="pb-notes">Why is it worth a visit</label>
      <textarea id="pb-notes" maxlength="400" placeholder="Ten minutes from the ground, proper beer, no bother with away shirts."></textarea></div>
    <div class="field">
      <label for="pb-welcome">Away shirts</label>
      <select id="pb-welcome">
        <option value="">Not sure</option>
        <option value="yes">Welcome, no bother</option>
        <option value="mixed">Fine if you keep it quiet</option>
        <option value="no">Home fans only, give it a miss</option>
      </select>
    </div>
    <div class="btn-row">
      <button class="btn btn--full" id="pb-save">Add recommendation</button>
      <button class="btn btn--ghost" id="pb-cancel">Cancel</button>
    </div>`);

  $("#pb-cancel", node).addEventListener("click", close);
  $("#pb-save", node).addEventListener("click", () => {
    const name = $("#pb-name", node).value.trim();
    const notes = $("#pb-notes", node).value.trim();
    if (name.length < 2) return toast("Give the pub a name.");
    const check = db.checkPost(`${name} ${notes}`, { minLength: 0, maxLength: 480 });
    if (!check.ok) return toast(check.reason, "bad");
    const limit = db.rateLimit("pub", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason, "bad");
    db.addPub(team.id, {
      name, postcode: $("#pb-pc", node).value.trim().toUpperCase(), notes,
      awayFriendly: $("#pb-welcome", node).value || null,
    });
    close();
    toast("Thanks, that is on the board.", "good");
  });
}

/* ------------------------------------------------------------- grounds map */

/* Leaflet with OpenStreetMap tiles. Google's embed needs an API key with
   billing attached, which is not something a supporters' club should have to
   run. Leaflet is served from our own domain so it needs no exception in the
   content security policy, and it is only fetched when this screen opens. */
let leafletReady = null;

function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "assets/vendor/leaflet.css";
    document.head.append(css);

    const js = document.createElement("script");
    js.src = "assets/vendor/leaflet.js";
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error("map library did not load"));
    document.head.append(js);
  });
  return leafletReady;
}

function viewMap() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Grounds Map</h1>
      <p>Every ground in the division. Tap a marker for the away day guide.</p>
    </div>
    <div class="map-toolbar">
      <button class="btn btn--sm btn--ghost" id="map-fit-all">Show every ground</button>
      <button class="btn btn--sm btn--ghost" id="map-home">Back to Kettering</button>
    </div>
    <div id="grounds-map" class="grounds-map" role="application" aria-label="Map of grounds"></div>
    <div class="map-legend">
      <span><i class="dot-home"></i> Latimer Park</span>
      <span><i class="dot-away"></i> Away grounds</span>
      <span class="map-legend__note">Map data from OpenStreetMap</span>
    </div>
  </div>`);

  const withCoords = TEAMS.filter((t) => t.lat && t.lng);

  /* Leaflet measures the container the moment it is created, so it must not be
     created until the view has finished animating in and the pane has its real
     size. Building it any earlier left the tiles and the viewport disagreeing,
     which showed as a grey band and the wrong zoom. */
  function build(L) {
    const node = $("#grounds-map", wrap);
    if (!node || !node.isConnected || !node.clientHeight) return;

    const map = L.map(node, { scrollWheelZoom: false });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const marks = [[KTFC.lat, KTFC.lng]];

    L.circleMarker([KTFC.lat, KTFC.lng], {
      radius: 10, color: "#c09c54", weight: 3, fillColor: "#c09c54", fillOpacity: 0.9,
    })
      .addTo(map)
      .bindPopup(`<b>${esc(KTFC.name)}</b><br>${esc(KTFC.ground)}<br>${esc(KTFC.postcode)}`);

    withCoords.forEach((t) => {
      L.circleMarker([t.lat, t.lng], {
        radius: 7, color: "#c8323f", weight: 2, fillColor: "#9c1824", fillOpacity: 0.85,
      })
        .addTo(map)
        .bindPopup(
          `<b>${esc(t.name)}</b><br>${esc(t.stadium)}<br>${t.distanceMiles} miles away<br>` +
          `<a href="#/club/${esc(t.id)}">Away day guide</a>`
        );
      marks.push([t.lat, t.lng]);
    });

    /* The division runs nearly four degrees east to west but under one north
       to south, so fitting the lot on a phone leaves half the frame as sea.
       Open on the grounds nearest home instead, with the full spread a tap
       away. */
    map.setView([KTFC.lat, KTFC.lng], 8);

    /* Deliberately no invalidateSize on moveend. Doing that triggers another
       move, which redraws the tiles and restarts their fade in, so they sit
       at a fraction of full opacity and never finish. Leaflet handles tiles on
       its own; the only place the size genuinely needs refreshing is when the
       container itself changes, which the observer below covers. */
    $("#map-fit-all", wrap)?.addEventListener("click", () =>
      map.fitBounds(marks, { padding: [26, 26] })
    );
    $("#map-home", wrap)?.addEventListener("click", () =>
      map.setView([KTFC.lat, KTFC.lng], 8)
    );

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
      ro.observe(node);
    }
  }

  loadLeaflet()
    .then((L) => {
      const node = $("#grounds-map", wrap);
      if (!node) return;
      const view = node.closest(".view");
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        build(L);
      };
      if (view) view.addEventListener("animationend", once, { once: true });
      setTimeout(once, 350); /* reduced motion never fires animationend */
    })
    .catch(() => {
      const node = $("#grounds-map", wrap);
      if (node) {
        node.replaceWith(
          el(`<div class="empty"><b>Map unavailable</b>The map could not load. The away guide lists every ground with a link to open it in your maps app.</div>`)
        );
      }
    });

  return wrap;
}

/* ------------------------------------------------------- our own club page */

function viewPoppies() {
  const info = infoFor("kettering-town");
  const all = fixtures();
  const home = all.filter((f) => f.venue === "Home");
  const crest = "assets/crests/kettering-town.png";
  const row = state.league?.table?.find((r) => /kettering/i.test(r.name));

  const wrap = el(`<div>
    <div class="hub-hero">
      <img class="hub-hero__crest" src="${crest}" alt="">
      <div class="hub-hero__text">
        <h1>${esc(KTFC.name)}</h1>
        <p>The Poppies · ${esc(KTFC.ground)}${info?.founded ? ` · Founded ${info.founded}` : ""}</p>
      </div>
    </div>
  </div>`);

  /* Built out with the club's history this page ran to nearly eight screens,
     which is the same complaint the ratings page had. Same fix. */
  const PTABS = [["ground", "Ground"], ["story", "Story"], ["records", "Records"],
                 ["people", "People"], ["fixtures", "Fixtures"]];
  const ptab = state.poppiesTab;
  const ptabBar = el(`
    <div class="segmented" style="margin-bottom:16px" role="group" aria-label="About Kettering Town">
      ${PTABS.map(([k, l]) => `<button data-potab="${k}" class="${ptab === k ? "is-active" : ""}">${l}</button>`).join("")}
    </div>`);
  ptabBar.querySelectorAll("[data-potab]").forEach((b) =>
    b.addEventListener("click", () => {
      state.poppiesTab = b.dataset.potab;
      render({ toTop: true });
    }));
  wrap.append(ptabBar);

  if (ptab === "ground") {
  wrap.append(el(`<h2 class="section-title">Latimer Park</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Ground</div><div class="info__value">${esc(KTFC.ground)}</div></div>
        <div class="info"><div class="info__label">Postcode</div><div class="info__value">${esc(KTFC.postcode)}</div></div>
        <div class="info"><div class="info__label">Home games</div><div class="info__value">${home.length}</div></div>
        <div class="info"><div class="info__label">League position</div><div class="info__value" style="color:var(--accent)">${
          row ? row.position : "not yet"
        }</div></div>
      </div>
      <div class="map-actions">
        <a class="btn btn--map" href="${directionsUrl(KTFC)}" target="_blank" rel="noopener">${ICON.route} Directions</a>
        <a class="btn btn--map btn--ghost" href="${mapUrl(KTFC)}" target="_blank" rel="noopener">${ICON.pin} Open in Maps</a>
      </div>
      <div class="hint" style="text-align:center">${esc(KTFC.street)}, ${esc(KTFC.town)}, ${esc(KTFC.postcode)}</div>
    </div>`));

  /* Where the ground actually is catches people out, so it is worth saying
     plainly rather than leaving them to the postcode. */
  const gd = state.facts?.ground;
  if (gd) {
    const card = el(`<div class="card"></div>`);
    gd.paragraphs.forEach((t, i) => {
      card.append(el(`<p class="club-overview"${i ? ` style="margin-top:12px"` : ""}>${esc(t)}</p>`));
    });
    if (gd.note) card.append(el(`<p class="hint" style="margin-top:12px">${esc(gd.note)}</p>`));
    wrap.append(card);
  }

  /* tickets, confirmed from the club's own ticketing rather than estimated */
  wrap.append(el(`<h2 class="section-title">On the gate at Latimer Park</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="info-grid info-grid--3">
        <div class="info"><div class="info__label">${esc(KTFC.adultRange)}</div><div class="info__value" style="color:var(--accent)">£${KTFC.adultPrice}</div></div>
        <div class="info"><div class="info__label">Concession</div><div class="info__value">£${KTFC.concessionPrice}</div></div>
        <div class="info"><div class="info__label">${esc(KTFC.youthRange)}</div><div class="info__value">£${KTFC.youthPrice}</div></div>
      </div>
      <div class="hint">${esc(KTFC.priceNote)}</div>
    </div>`));
  }


  if (ptab === "story" && info?.summary) {
    wrap.append(el(`<h2 class="section-title">About the club</h2>`));
    const card = el(`<div class="card"><div class="info__value info__value--body">${esc(info.summary)}</div></div>`);
    const links = [];
    if (info.website) links.push(`<a class="btn btn--sm btn--ghost" href="${esc(info.website)}" target="_blank" rel="noopener">${ICON.globe} Official website</a>`);
    if (info.wikipedia) links.push(`<a class="btn btn--sm btn--ghost" href="${esc(info.wikipedia)}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (links.length) card.append(el(`<div class="btn-row" style="margin-top:14px">${links.join("")}</div>`));
    wrap.append(card);
  }

  /* Researched rather than guessed. Every claim here traces to the club's own
     site or its Wikipedia article, and the file says which. */
  const facts = state.facts;
  if (facts && ptab === "story") {
    facts.story.forEach((bit) => {
      wrap.append(el(`<h2 class="section-title">${esc(bit.title)}</h2>`));
      wrap.append(el(`<div class="card"><p class="club-overview">${esc(bit.text)}</p></div>`));
    });

  }

  if (facts && ptab === "records") {
    if (facts.records?.length) {
      wrap.append(el(`<h2 class="section-title">Club records</h2>`));
      const card = el(`<div class="card ratings-board"></div>`);
      facts.records.forEach((r) => {
        card.append(el(`
          <div class="lb lb--plain">
            <span class="lb__who">
              <span class="lb__name">${esc(r.value)}</span>
              <span class="lb__meta">${esc([r.label, r.detail].filter(Boolean).join(" \u00B7 "))}</span>
            </span>
          </div>`));
      });
      wrap.append(card);
    }

    if (facts.honours?.length) {
      wrap.append(el(`<h2 class="section-title">Honours</h2>`));
      const card = el(`<div class="card"></div>`);
      facts.honours.forEach((h) => {
        card.append(el(`<div class="events__head">${esc(h.competition)}</div>`));
        h.wins.forEach((w) => card.append(el(`<div class="honour">${esc(w)}</div>`)));
      });
      wrap.append(card);
    }

    if (facts.managers?.notable?.length) {
      wrap.append(el(`<h2 class="section-title">In the dugout</h2>`));
      const card = el(`<div class="card"></div>`);
      if (facts.managers.note) card.append(el(`<p class="note" style="margin:0 0 12px">${esc(facts.managers.note)}</p>`));
      facts.managers.notable.forEach((m) => {
        card.append(el(`
          <div class="crew">
            <span class="crew__who">${esc(m.name)}${
              m.detail ? `<span class="crew__note">${esc(m.detail)}</span>` : ""
            }</span>
            <span class="crew__when">${esc(m.years)}</span>
          </div>`));
      });
      wrap.append(card);

      /* The full list rather than a slice of it. Newest first, because that is
         the end people are looking for. */
      if (facts.managers.history?.length) {
        const all = el(`
          <details class="older-match">
            <summary>All ${facts.managers.history.length} spells in charge, 1956 to now</summary>
          </details>`);
        const inner = el(`<div class="card" style="margin-top:10px"></div>`);
        facts.managers.history.slice().reverse().forEach((m) => {
          const note = [m.caretaker ? "caretaker" : "", m.joint ? "joint" : ""].filter(Boolean).join(", ");
          inner.append(el(`
            <div class="crew">
              <span class="crew__who">${esc(m.name)}${
                note ? ` <span class="crew__tag">${esc(note)}</span>` : ""
              }</span>
              <span class="crew__when">${esc(m.years)}</span>
            </div>`));
        });
        all.append(inner);
        wrap.append(all);
        if (facts.managers.churn) {
          wrap.append(el(`<p class="note">${esc(facts.managers.churn)}</p>`));
        }
      }
    }

    wrap.append(el(`<p class="note">Club history from the Kettering Town Wikipedia article and the club's own site.</p>`));
  }

  if (facts && ptab === "people") {
    const people = facts.officials;
    if (!people?.board?.length && !people?.staff?.length) {
      wrap.append(el(`<div class="empty"><b>Nobody listed yet</b>The club has not published who
        runs it.</div>`));
      return wrap;
    }

    wrap.append(el(`<h2 class="section-title">Who runs the club</h2>`));
    const card = el(`<div class="card"></div>`);
    const group = (heading, list) => {
      if (!list?.length) return;
      card.append(el(`<div class="events__head">${esc(heading)}</div>`));
      list.forEach((o) => {
        card.append(el(`
          <div class="crew">
            <span class="crew__who">${esc(o.name)}${
              o.detail ? `<span class="crew__note">${esc(o.detail)}</span>` : ""
            }</span>
            <span class="crew__when">${esc(o.role)}</span>
          </div>`));
      });
    };
    group("Football staff", people.staff);
    if (people.staffNote) {
      card.append(el(`<p class="note" style="margin:8px 0 14px">${esc(people.staffNote)}</p>`));
    }
    group("The boardroom", people.board);
    if (people.boardNote) {
      card.append(el(`<p class="note" style="margin:8px 0 0">${esc(people.boardNote)}</p>`));
    }
    wrap.append(card);

    /* Said out loud, with the date. A list of who runs a football club goes out
       of date the week you publish it, and this one already has: the club's own
       page still names a manager who left before the season started. */
    if (people.source) {
      wrap.append(el(`
        <p class="note" style="margin-top:14px">Taken from the club's own website
        (${esc(people.source.replace(/^Kettering Town FC official website, /, ""))})${
          people.checked ? `, checked ${esc(fmtDate(people.checked))}` : ""}.
        ${esc(people.note || "")}</p>`));
      /* Straight to the page this came from, so anybody can check it against
         the source rather than take our word for a list that will go stale. */
      if (people.sourceUrl) {
        wrap.append(el(`
          <div class="btn-row" style="margin-top:12px">
            <a class="btn btn--sm btn--ghost" href="${esc(people.sourceUrl)}"
               target="_blank" rel="noopener">${ICON.globe} See it on the club's site</a>
          </div>`));
      }
    }
    return wrap;
  }

  if (ptab !== "fixtures") return wrap;

  const next = home.find((f) => f.date >= todayISO());
  if (next) {
    wrap.append(el(`<h2 class="section-title">Next at home</h2>`));
    wrap.append(fixtureCard(next));
  }

  wrap.append(el(`<h2 class="section-title">Every home game</h2>`));
  if (!home.length) {
    wrap.append(el(`<div class="empty"><b>No home fixtures listed</b>They will appear once the league publishes them.</div>`));
  } else {
    home.forEach((f) => wrap.append(fixtureCard(f)));
  }

  return wrap;
}

/* ================================================================== travel */

function viewTravel() {
  const admin = db.isAdmin();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Travel</h1>
      <p>Official coach details from the KTFCSA team, plus a car share board run by fellow fans.</p>
    </div>
  </div>`);

  /* ---- coach travel, admin managed ---- */
  const head = el(`<h2 class="section-title">Coach travel</h2>`);
  wrap.append(head);

  const coaches = db.list("coach");
  const upcoming = fixtures().filter((f) => f.date >= todayISO());

  if (admin) {
    const addBtn = el(`<button class="btn btn--sm" style="margin-bottom:10px">Add a coach notice</button>`);
    addBtn.addEventListener("click", () => coachForm(upcoming));
    wrap.append(addBtn);
  }

  if (!coaches.length) {
    wrap.append(el(`<div class="empty"><b>No coach announced yet</b>${
      admin ? "Use the button above to post this week's details." : "The KTFCSA team will post details here each week."
    }</div>`));
  } else {
    coaches.forEach((c) => {
      const card = el(`
        <div class="post">
          <div class="post__head">
            <span class="pill pill--gold">Official coach</span>
            ${c.fixture ? `<span class="pill pill--muted">${esc(c.fixture)}</span>` : ""}
            <span class="post__when">${esc(relTime(c.createdAt))}</span>
          </div>
          <div class="post__body">${esc(c.notes)}</div>
          <div class="post__meta">
            ${c.departs ? `<span>Departs <b>${esc(c.departs)}</b></span>` : ""}
            ${c.pickup ? `<span>From <b>${esc(c.pickup)}</b></span>` : ""}
            ${c.price ? `<span>Fare <b>${esc(c.price)}</b></span>` : ""}
            ${c.contact ? `<span>Book with <b>${esc(c.contact)}</b></span>` : ""}
          </div>
        </div>`);
      if (admin) {
        const actions = el(`<div class="post__actions">
          <button class="link-btn" data-act="edit">Edit</button>
          <button class="link-btn" data-act="del">Remove</button>
        </div>`);
        actions.querySelector('[data-act="edit"]').addEventListener("click", () => coachForm(upcoming, c));
        actions.querySelector('[data-act="del"]').addEventListener("click", () => {
          db.drop("coach", c.id);
          toast("Coach notice removed.");
          render();
        });
        card.append(actions);
      }
      wrap.append(card);
    });
  }

  /* ---- car share ---- */
  wrap.append(el(`<h2 class="section-title">Car share board</h2>`));
  wrap.append(el(`
    <div class="notice notice--warn">
      Car shares are arranged between supporters directly. KTFCSA does not vet drivers,
      check insurance or take any responsibility for lifts arranged here. Agree the details
      yourself, make sure someone knows where you are going, and never share bank details.
    </div>`));

  const user = db.currentUser();
  if (user) {
    const btns = el(`<div class="btn-row" style="margin-bottom:14px">
      <button class="btn btn--sm" data-act="offer">Offer a lift</button>
      <button class="btn btn--sm btn--ghost" data-act="request">Ask for a lift</button>
    </div>`);
    btns.querySelector('[data-act="offer"]').addEventListener("click", () => liftForm("offer", upcoming));
    btns.querySelector('[data-act="request"]').addEventListener("click", () => liftForm("request", upcoming));
    wrap.append(btns);
  } else {
    wrap.append(el(`<div class="notice notice--info">Sign in to offer or ask for a lift. It takes one tap and only needs a name.</div>`));
  }

  /* only show lifts for fixtures that have not long gone */
  const cutoff = new Date(Date.now() - CONFIG.liftExpiryDays * 86400000);
  const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const lifts = db.list("lift").filter((l) => !l.fixtureDate || l.fixtureDate >= cutoffISO);

  if (!lifts.length) {
    wrap.append(el(`<div class="empty"><b>The board is empty</b>Be the first to offer a seat or ask for one.</div>`));
    return wrap;
  }

  /* group by fixture so the board follows the season */
  const groups = new Map();
  lifts.forEach((l) => {
    const key = l.fixture || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });
  [...groups.entries()]
    .sort((a, b) => (a[1][0].fixtureDate || "9999").localeCompare(b[1][0].fixtureDate || "9999"))
    .forEach(([fixture, rows]) => {
      wrap.append(el(`<div class="month">${esc(fixture)}</div>`));
      rows.forEach((l) => wrap.append(liftCard(l)));
    });

  return wrap;
}

function liftCard(l) {
  const card = el(`
    <div class="post post--${l.kind}">
      <div class="post__head">
        ${avatarHtml(l.authorName, l.authorId)}
        <span class="post__who">${esc(l.authorName)}</span>
        <span class="pill pill--${l.kind === "offer" ? "home" : "muted"}">${l.kind === "offer" ? "Offering" : "Looking"}</span>
        <span class="post__when">${esc(relTime(l.createdAt))}</span>
      </div>
      ${l.notes ? `<div class="post__body">${esc(l.notes)}</div>` : ""}
      <div class="post__meta">
        ${l.area ? `<span>From <b>${esc(l.area)}</b></span>` : ""}
        ${l.leaving ? `<span>Leaving <b>${esc(l.leaving)}</b></span>` : ""}
        ${l.kind === "offer" && l.seats ? `<span>Seats <b>${esc(l.seats)}</b></span>` : ""}
        ${l.contact ? `<span>Contact <b>${esc(l.contact)}</b></span>` : ""}
      </div>
    </div>`);

  if (db.canEdit(l)) {
    const actions = el(`<div class="post__actions"><button class="link-btn">Remove</button></div>`);
    actions.querySelector("button").addEventListener("click", () => {
      db.drop("lift", l.id);
      toast("Post removed.");
      render();
    });
    card.append(actions);
  }
  return card;
}

function fixtureOptions(list) {
  return list
    .map((f) => `<option value="${esc(f.date)}|${esc(f.opponent)} (${esc(f.venue)})">${esc(fmtDate(f.date, "short"))} · ${esc(f.opponent)} (${esc(f.venue)})</option>`)
    .join("");
}

function liftForm(kind, upcoming) {
  const { node, close } = modal(`
    <h2>${kind === "offer" ? "Offer a lift" : "Ask for a lift"}</h2>
    <p class="sub">Share only what you are comfortable being seen by other supporters.</p>
    <div class="field"><label for="lf-fix">Which match</label>
      <select id="lf-fix">${fixtureOptions(upcoming)}</select></div>
    <div class="field-row field-row--2">
      <div class="field"><label for="lf-area">Setting off from</label>
        <input id="lf-area" placeholder="Kettering town centre" maxlength="60"></div>
      <div class="field"><label for="lf-time">Leaving at</label>
        <input id="lf-time" placeholder="12:30" maxlength="20"></div>
    </div>
    ${kind === "offer" ? `<div class="field"><label for="lf-seats">Seats free</label>
      <input id="lf-seats" type="number" min="1" max="7" value="3"></div>` : ""}
    <div class="field"><label for="lf-contact">How to reach you</label>
      <input id="lf-contact" placeholder="Message me on the fan wall" maxlength="60">
      <div class="hint">A first name and a way to reach you is plenty. Do not post your home address.</div></div>
    <div class="field"><label for="lf-notes">Anything else</label>
      <textarea id="lf-notes" maxlength="400" placeholder="Happy to pick up on the way."></textarea></div>
    <div class="btn-row">
      <button class="btn btn--full" id="lf-save">Post to the board</button>
      <button class="btn btn--ghost" id="lf-cancel">Cancel</button>
    </div>`);

  $("#lf-cancel", node).addEventListener("click", close);
  $("#lf-save", node).addEventListener("click", () => {
    const notes = $("#lf-notes", node).value.trim();
    if (notes) {
      const check = db.checkPost(notes, { minLength: 0, maxLength: 400 });
      if (!check.ok) return toast(check.reason, "bad");
    }
    const limit = db.rateLimit("lift", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason, "bad");

    const [fixtureDate, fixture] = $("#lf-fix", node).value.split("|");
    db.add("lift", {
      kind,
      fixture,
      fixtureDate,
      area: $("#lf-area", node).value.trim().slice(0, 60),
      leaving: $("#lf-time", node).value.trim().slice(0, 20),
      seats: kind === "offer" ? $("#lf-seats", node).value : "",
      contact: $("#lf-contact", node).value.trim().slice(0, 60),
      notes,
    });
    close();
    toast("Posted to the car share board.", "good");
    render();
  });
}

function coachForm(upcoming, existing) {
  const { node, close } = modal(`
    <h2>${existing ? "Edit coach notice" : "Add a coach notice"}</h2>
    <p class="sub">This is the only part of the app that needs a weekly update.</p>
    <div class="field"><label for="cf-fix">Which match</label>
      <select id="cf-fix">${fixtureOptions(upcoming)}</select></div>
    <div class="field-row field-row--2">
      <div class="field"><label for="cf-dep">Departs</label>
        <input id="cf-dep" value="${esc(existing?.departs || "")}" placeholder="11:00" maxlength="30"></div>
      <div class="field"><label for="cf-price">Fare</label>
        <input id="cf-price" value="${esc(existing?.price || "")}" placeholder="£15 members, £18 non-members" maxlength="60"></div>
    </div>
    <div class="field"><label for="cf-pick">Pick-up point</label>
      <input id="cf-pick" value="${esc(existing?.pickup || "")}" placeholder="Latimer Park car park" maxlength="80"></div>
    <div class="field"><label for="cf-contact">Book with</label>
      <input id="cf-contact" value="${esc(existing?.contact || "")}" placeholder="Dave on 07xxx, or at the club shop" maxlength="80"></div>
    <div class="field"><label for="cf-notes">Details</label>
      <textarea id="cf-notes" maxlength="600" placeholder="Seats must be paid for by the Thursday before the match.">${esc(existing?.notes || "")}</textarea></div>
    <div class="btn-row">
      <button class="btn btn--full" id="cf-save">${existing ? "Save changes" : "Post notice"}</button>
      <button class="btn btn--ghost" id="cf-cancel">Cancel</button>
    </div>`);

  if (existing?.fixtureDate) {
    const opt = [...$("#cf-fix", node).options].find((o) => o.value.startsWith(existing.fixtureDate));
    if (opt) $("#cf-fix", node).value = opt.value;
  }

  $("#cf-cancel", node).addEventListener("click", close);
  $("#cf-save", node).addEventListener("click", () => {
    const notes = $("#cf-notes", node).value.trim();
    if (!notes) return toast("Add a few details before posting.");
    const [fixtureDate, fixture] = $("#cf-fix", node).value.split("|");
    const payload = {
      fixture,
      fixtureDate,
      departs: $("#cf-dep", node).value.trim(),
      price: $("#cf-price", node).value.trim(),
      pickup: $("#cf-pick", node).value.trim(),
      contact: $("#cf-contact", node).value.trim(),
      notes,
    };
    if (existing) db.update("coach", existing.id, payload);
    else db.add("coach", payload);
    close();
    toast(existing ? "Coach notice updated." : "Coach notice posted.");
    render();
  });
}

/* ================================================================= podcast */

function viewPodcast() {
  const p = state.podcast;
  const wrap = el(`<div>
    <div class="page-head">
      <h1>The Poppycast</h1>
      <p>A fan-led podcast and partners of KTFCSA. New episodes appear here on their own.</p>
    </div>
  </div>`);

  if (!p) {
    wrap.append(el(`<div class="skeleton" style="height:120px"></div>`));
    wrap.append(el(`<div class="skeleton"></div><div class="skeleton"></div>`));
    return wrap;
  }

  if (!p.episodes?.length) {
    wrap.append(el(`<div class="empty"><b>Episodes unavailable</b>The feed could not be reached just now. Please try again shortly.</div>`));
    return wrap;
  }

  wrap.append(el(`
    <div class="pod-hero">
      ${p.image ? `<img class="pod-hero__art" src="${esc(p.image)}" alt="The Poppycast artwork">` : ""}
      <div class="pod-hero__text">
        <h2 style="margin:0 0 6px;font-size:1.1875rem;font-weight:780">${esc(p.title)}</h2>
        <p style="margin:0;color:var(--text-2);font-size:0.8125rem;line-height:1.55">${esc((p.description || "").slice(0, 260))}</p>
        <div class="btn-row" style="margin-top:12px">
          ${p.link ? `<a class="btn btn--sm btn--ghost" href="${esc(p.link)}" target="_blank" rel="noopener">Show page</a>` : ""}
          <a class="btn btn--sm btn--ghost" href="${esc(p.feed)}" target="_blank" rel="noopener">RSS feed</a>
        </div>
      </div>
    </div>`));

  wrap.append(el(`<h2 class="section-title">Episodes</h2>`));

  p.episodes.forEach((ep) => {
    const when = ep.publishedISO
      ? new Date(ep.publishedISO).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : "";
    const card = el(`
      <div class="episode">
        <div class="episode__head">
          <button class="play-btn" aria-label="Play ${esc(ep.title)}">▶</button>
          <div class="episode__title">${esc(ep.title)}
            <div class="episode__meta">${esc(when)}${ep.duration ? ` · ${esc(ep.duration)}` : ""}</div>
          </div>
        </div>
        ${ep.description ? `<div class="episode__desc">${esc(ep.description.slice(0, 260))}${ep.description.length > 260 ? "…" : ""}</div>` : ""}
      </div>`);

    card.querySelector(".play-btn").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (card.querySelector("audio")) {
        card.querySelector("audio").remove();
        btn.textContent = "▶";
        return;
      }
      document.querySelectorAll(".episode audio").forEach((a) => a.remove());
      document.querySelectorAll(".play-btn").forEach((b) => (b.textContent = "▶"));
      btn.textContent = "❚❚";
      const audio = el(`<audio controls preload="none" src="${esc(ep.audio)}"></audio>`);
      card.append(audio);
      audio.play().catch(() => {});
    });

    wrap.append(card);
  });

  return wrap;
}

/* =========================================================== player ratings */

/* Nobody keeps a public squad list for this division, and the club site runs
   behind. So the app never hard codes a squad: names come from the team sheets
   in the league feed, and a volunteer can type one in when the feed misses a
   game. A player appears once they have actually played. */

/**
 * The Kettering names for a fixture: a volunteer's sheet if there is one, else
 * the feed's.
 *
 * This used to be the other way round, which made the editor a lie. The feed
 * named two players for the Leamington game who did not play, a volunteer took
 * them out, the save worked, the toast said so, and the page went on showing
 * the feed because the feed was checked first. The row was correct in the
 * database the whole time and nothing read it.
 *
 * A volunteer wins now, because they were at the ground and the feed was not.
 * Only an admin can type one, and the card says whose sheet is being shown
 * with a way to hand it back to the league's.
 */
function squadFor(fixture) {
  const typed = db.lineupFor(fixture.id);
  if (typed.length) return { players: typed, source: "volunteer" };
  const fromFeed = fixture.lineup || [];
  if (fromFeed.length) return { players: fromFeed, source: "feed" };
  return { players: [], source: null };
}

/** The squad the club confirmed, in shirt number order. */
const confirmedSquad = () => state.squad?.players || [];

const POSITION_ORDER = ["GK", "DF", "MF", "ST"];
const POSITION_LABEL = { GK: "Goalkeepers", DF: "Defenders", MF: "Midfielders", ST: "Forwards" };

/* Team sheets go up about an hour before kick-off, so the panel has to be
   reachable before the game starts or a volunteer is locked out holding the
   sheet. Ratings themselves still wait for kick-off. */
const SHEET_OPENS_MS = 3 * 60 * 60 * 1000;

const hasKickedOff = (f) => {
  const ko = kickoffTime(f);
  return Boolean(ko) && ko.getTime() <= Date.now();
};

/** Matches near enough to matter: kicked off, or kicking off shortly. */
const ratableFixtures = () =>
  fixtures()
    .filter((f) => {
      const ko = kickoffTime(f);
      return ko && ko.getTime() - SHEET_OPENS_MS <= Date.now() && f.status !== "off";
    })
    .reverse();

/** One player, with the buttons to mark them out of ten. */
function ratingRow(fixture, player, open) {
  const mine = db.myRating(fixture.id, player.name);
  const all = db.matchRating(fixture.id, player.name);
  const row = el(`
    <div class="rating">
      <div class="rating__who">
        <span class="rating__num">${player.number ?? ""}</span>
        <span class="rating__name">${esc(player.name)}${player.captain ? ` <span class="rating__cap" title="Captain">C</span>` : ""}</span>
        ${player.started === false ? `<span class="rating__sub">sub</span>` : ""}
      </div>
      <div class="rating__score">
        ${all ? `<span class="rating__avg"><b>${all.average}</b>${all.voters} rating${all.voters === 1 ? "" : "s"}</span>`
              : `<span class="rating__avg rating__avg--none">Not rated yet</span>`}
      </div>
    </div>`);

  if (!open) return row;

  const scale = el(`<div class="scale" role="group" aria-label="Rate ${esc(player.name)} out of ten"></div>`);
  for (let n = 1; n <= 10; n += 1) {
    const b = el(`<button class="scale__btn${mine === n ? " is-mine" : ""}" type="button" aria-pressed="${mine === n}">${n}</button>`);
    b.addEventListener("click", () => db.ratePlayer(fixture.id, player.name, n));
    scale.append(b);
  }
  row.append(scale);
  if (mine) row.append(el(`<p class="rating__hint">You gave ${mine}. Tap it again to take it back.</p>`));
  return row;
}

/** The panel that lets a supporter mark a match, shared with the reaction thread. */
function ratingPanel(fixture, { withEvents = true } = {}) {
  const wrap = el(`<div class="card"></div>`);
  const { players, source } = squadFor(fixture);
  const opponent = clubName(fixture.opponent);
  const score = fixture.homeScore !== null ? `${fixture.homeScore} - ${fixture.awayScore}` : "";

  wrap.append(el(`
    <div class="card__head">
      <h3>${esc(opponent)}${score ? ` <span class="card__score">${esc(score)}</span>` : ""}</h3>
      <p>${esc(fmtDate(fixture.date))}, ${fixture.venue === "Home" ? "home" : "away"}</p>
    </div>`));

  /* The reaction thread prints these above the panel already, so it asks for
     them to be left out rather than showing the same eight lines twice. */
  const ev = withEvents ? matchEvents(fixture) : null;
  if (ev) wrap.append(ev);

  if (!players.length) {
    wrap.append(el(`
      <div class="empty">
        <b>No team sheet for this one</b>
        The league has not published who played. A volunteer can add it below.
      </div>`));
    if (db.isAdmin()) wrap.append(lineupForm(fixture));
    return wrap;
  }

  const started = hasKickedOff(fixture);
  const signedIn = Boolean(db.currentUser()) && started;
  if (!started) {
    wrap.append(el(`<p class="note">The team sheet is up. Marks open at kick-off.</p>`));
  } else if (!signedIn) {
    wrap.append(el(`<p class="note">Ratings need an account, so each supporter marks a player once. The averages below are everyone's.</p>`));
  }

  players.forEach((pl) => wrap.append(ratingRow(fixture, pl, signedIn)));

  if (source === "volunteer") {
    const note = el(`<p class="rating__source">Team sheet corrected by a volunteer, not the league's.</p>`);
    if (db.isAdmin()) {
      const undo = el(`<button class="link-btn">Use the league's sheet instead</button>`);
      undo.addEventListener("click", () => {
        db.deleteLineup(fixture.id);
        toast("Back to the league's team sheet.");
      });
      note.append(document.createTextNode(" "));
      note.append(undo);
    }
    wrap.append(note);
  }

  /* A correction leaves marks behind: somebody rated a player who turns out
     not to have been on the pitch, and that mark would go on counting towards
     his season average. Only offered when there is actually something stranded. */
  if (db.isAdmin()) {
    const onSheet = new Set(players.map((p) => p.name.toLowerCase()));
    const stranded = [...new Set(db.ratedNamesFor(fixture.id))]
      .filter((n) => !onSheet.has(String(n).toLowerCase()));
    if (stranded.length) {
      const row = el(`
        <div class="empty" style="text-align:left;padding:14px 16px">
          <b>Marks for ${stranded.length} player${stranded.length === 1 ? "" : "s"} no longer on this sheet</b>
          ${esc(stranded.join(", "))}. These still count towards a season average.
        </div>`);
      const go = el(`<button class="btn btn--sm btn--ghost" style="margin-top:10px">Remove those marks</button>`);
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          const n = await db.clearRatingsFor(fixture.id, stranded);
          toast(n ? `Removed ${n} mark${n === 1 ? "" : "s"}.` : "Nothing to remove.");
          render();
        } catch (err) {
          go.disabled = false;
          toast(err.message || "Those marks did not come off.");
        }
      });
      row.append(go);
      wrap.append(row);
    }
  }

  if (db.isAdmin()) wrap.append(lineupForm(fixture, players));
  return wrap;
}

/** Volunteers type a team sheet in, whether to fill a gap or correct the feed. */
function lineupForm(fixture, existing = []) {
  const box = el(`
    <details class="lineup-form">
      <summary>${existing.length ? "Edit the team sheet" : "Add the team sheet"}</summary>
      <p class="note">Saving this replaces the league\u2019s sheet for this game. One player per line, starters first. Put a number in front if you have it, and (c) after the captain. Add "sub" after anyone who came off the bench.</p>
      <textarea rows="8" placeholder="1 Jane Smith&#10;4 Alex Jones (c)&#10;14 Sam Patel sub"></textarea>
      <button class="btn btn--full" type="button">Save the team sheet</button>
    </details>`);

  const ta = box.querySelector("textarea");
  const asLines = (list) =>
    list
      .map((pl) => [pl.number, pl.name, pl.captain ? "(c)" : "", pl.started === false ? "sub" : ""].filter(Boolean).join(" "))
      .join("\n");
  /* Starting from the confirmed squad beats typing eighteen names on a phone
     at full time. Delete whoever did not play. */
  ta.value = existing.length ? asLines(existing) : asLines(confirmedSquad());

  box.querySelector("button").addEventListener("click", () => {
    const players = parseLineup(ta.value);
    if (!players.length) {
      toast("Type at least one player before saving.");
      return;
    }
    db.saveLineup(fixture.id, players);
    toast("Team sheet saved.");
  });
  return box;
}

/** Turns typed lines like "4 Alex Jones (c)" into player records. */
function parseLineup(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let rest = line;
      let number = null;
      const num = rest.match(/^(\d{1,2})[.)]?\s+/);
      if (num) {
        number = Number(num[1]);
        rest = rest.slice(num[0].length);
      }
      const captain = /\(c\)/i.test(rest);
      rest = rest.replace(/\(c\)/ig, "");
      const started = !/\bsub\b/i.test(rest);
      rest = rest.replace(/\bsub\b/ig, "");
      return { name: rest.replace(/\s+/g, " ").trim(), number, captain, started };
    })
    .filter((pl) => pl.name.length >= 2)
    .slice(0, 25);
}

function viewPlayers() {
  const wrap = el(`<div></div>`);
  wrap.append(el(`
    <div class="page-head">
      <h1>Players &amp; stats</h1>
      <p>Mark the Poppies out of ten after each game. Whoever the league names on the team sheet is who you rate, so loanees and new signings appear the moment they play.</p>
    </div>`));

  /* Everything on one page came to six screens of numbers, which is more than
     anyone wants to scroll past to find one thing. Same segmented control the
     fixture list and the prediction league already use. */
  const TABS = [["rate", "Rate"], ["ratings", "Season Ratings"], ["stats", "Season Stats"], ["squad", "Squad"]];
  const tab = state.playerTab;
  const tabBar = el(`
    <div class="segmented" style="margin-bottom:16px" role="group" aria-label="Players and stats">
      ${TABS.map(([k, label]) => `<button data-pltab="${k}" class="${tab === k ? "is-active" : ""}">${label}</button>`).join("")}
    </div>`);
  tabBar.querySelectorAll("[data-pltab]").forEach((b) =>
    b.addEventListener("click", () => {
      state.playerTab = b.dataset.pltab;
      render({ toTop: true });
    }));
  wrap.append(tabBar);

  const BLURB = {
    rate: "Give them a mark out of ten. Everyone gets one vote per player.",
    ratings: "How the supporters have marked them so far this season.",
    stats: "Who is scoring, and who keeps finding the referee's notebook.",
    squad: "The squad as the club confirmed it, with anyone else who has played.",
  };
  wrap.append(el(`<p class="tab-blurb">${esc(BLURB[tab] || "")}</p>`));

  /* ---- the season so far ---- */
  const season = db.seasonRatings();
  if (season.length && tab === "ratings") {
    wrap.append(el(`<h2 class="section-title">This season</h2>`));

    /* A three column table was too wide for a phone, so this is a list: the
       mark is the thing people look at, and a bar makes the order readable
       without reading a single number. */
    const byName = Object.fromEntries(confirmedSquad().map((pl) => [pl.name, pl]));
    const board = el(`<div class="card ratings-board"></div>`);
    const best = Math.max(...season.map((r) => Number(r.average) || 0), 0);

    season.forEach((r, i) => {
      const pl = byName[r.player_name];
      const avg = Number(r.average) || 0;
      const rank = i > 0 && season[i - 1].average === r.average ? "" : String(i + 1);
      board.append(el(`
        <div class="lb${avg === best && best > 0 ? " lb--top" : ""}">
          <span class="lb__rank lb__rank--${rank && Number(rank) <= 3 ? rank : "plain"}">${rank}</span>
          <span class="lb__who">
            <span class="lb__name" data-player="${esc(r.player_name)}">${esc(r.player_name)}${
              pl?.loan ? ` <span class="squad__loan">Loan</span>` : ""
            }</span>
            <span class="lb__meta">${
              [pl?.position, `${r.matches} game${r.matches === 1 ? "" : "s"}`,
               r.voters ? `${r.voters} rating${r.voters === 1 ? "" : "s"}` : ""]
                .filter(Boolean).map(esc).join(" · ")
            }</span>
          </span>
          <span class="lb__bar" aria-hidden="true"><i style="width:${Math.round(avg * 10)}%"></i></span>
          <span class="lb__avg">${r.average}</span>
        </div>`));
    });
    wrap.append(board);
    wrap.append(el(`<p class="note">An average across every match a player has been rated in. Early in the season a single good game moves it a long way.</p>`));
  }

  /* ---- goals, cards and gates from the league feed ---- */
  const stats = seasonStats();
  if (stats.played && tab === "stats") {
    const byName = Object.fromEntries(confirmedSquad().map((pl) => [pl.name, pl]));

    if (stats.scorers.length) {
      wrap.append(el(`<h2 class="section-title">Goals</h2>`));
      const most = stats.scorers[0].goals;

      /* Early in a season half the squad is on one goal, so the card has to
         cope with a tie rather than crowning whoever sorted first. */
      const leaders = stats.scorers.filter((r) => r.goals === most);
      const leadCard = el(`<div class="topscorer"></div>`);
      leadCard.append(el(`<div class="topscorer__ball" aria-hidden="true">\u26BD</div>`));

      const who = el(`<div class="topscorer__who"></div>`);
      who.append(el(`<div class="topscorer__label">${
        leaders.length > 1 ? `Leading scorers, level on ${most}` : "Leading scorer"
      }</div>`));
      leaders.slice(0, 4).forEach((r) => {
        const pl = byName[r.name];
        who.append(el(`
          <div class="topscorer__name" data-player="${esc(r.name)}">${esc(r.name)}</div>`));
        if (leaders.length === 1) {
          who.append(el(`<div class="topscorer__sub">${esc(pl?.position || "")}${
            pl?.number ? ` \u00B7 shirt ${pl.number}` : ""
          }</div>`));
        }
      });
      if (leaders.length > 4) {
        who.append(el(`<div class="topscorer__sub">and ${leaders.length - 4} more</div>`));
      }
      leadCard.append(who);
      leadCard.append(el(`<div class="topscorer__count">${most}<span>goal${most === 1 ? "" : "s"}</span></div>`));
      wrap.append(leadCard);
      const card = el(`<div class="card ratings-board"></div>`);
      /* Whoever is on the card above does not appear again underneath. Skipping
         only the first was fine while there was one leader, and duplicated
         Gyasi the moment two were level. */
      const rest = stats.scorers.filter((r) => r.goals !== most);
      rest.forEach((r, i0) => {
        const i = leaders.length + i0;
        const pl = byName[r.name];
        const rank = i0 > 0 && rest[i0 - 1].goals === r.goals ? "" : String(i + 1);
        card.append(el(`
          <div class="lb">
            <span class="lb__rank">${rank}</span>
            <span class="lb__who">
              <span class="lb__name" data-player="${esc(r.name)}">${esc(r.name)}</span>
              <span class="lb__meta">${esc(pl?.position || "")}</span>
            </span>
            <span class="lb__bar" aria-hidden="true"><i style="width:${Math.round((r.goals / most) * 100)}%"></i></span>
            <span class="lb__avg">${r.goals}</span>
          </div>`));
      });
      if (rest.length) wrap.append(card);
    }

    if (stats.discipline.length) {
      wrap.append(el(`<h2 class="section-title">Cards</h2>`));
      const card = el(`<div class="card ratings-board"></div>`);
      stats.discipline.forEach((r) => {
        card.append(el(`
          <div class="lb lb--plain">
            <span class="lb__who">
              <span class="lb__name" data-player="${esc(r.name)}">${esc(r.name)}</span>
              <span class="lb__meta">${esc(byName[r.name]?.position || "")}</span>
            </span>
            <span class="lb__cards">${
              [r.yellows ? `${ICON_YELLOW} ${r.yellows}` : "", r.reds ? `${ICON_RED} ${r.reds}` : ""]
                .filter(Boolean).join(" ")
            }</span>
          </div>`));
      });
      wrap.append(card);
    }

    if (stats.gates.length || stats.awayGates.length) {
      const mean = (a) => Math.round(a.reduce((n, g) => n + g, 0) / a.length);
      const n = (v) => v.toLocaleString("en-GB");
      wrap.append(el(`<h2 class="section-title">At the gate</h2>`));
      const card = el(`<div class="card"></div>`);

      if (stats.gates.length) {
        card.append(el(`<div class="events__head">At Latimer Park</div>`));
        card.append(el(`
          <div class="info-grid info-grid--3">
            <div class="info"><div class="info__label">Games</div><div class="info__value">${stats.gates.length}</div></div>
            <div class="info"><div class="info__label">Average</div><div class="info__value" style="color:var(--accent)">${n(mean(stats.gates))}</div></div>
            <div class="info"><div class="info__label">Best</div><div class="info__value">${n(Math.max(...stats.gates))}</div></div>
          </div>`));
      }

      /* The other half of the season. These were read off the feed and thrown
         away, which is a strange thing to do to the crowd you travelled with. */
      if (stats.awayGates.length) {
        card.append(el(`<div class="events__head" style="margin-top:14px">On the road</div>`));
        card.append(el(`
          <div class="info-grid info-grid--3">
            <div class="info"><div class="info__label">Games</div><div class="info__value">${stats.awayGates.length}</div></div>
            <div class="info"><div class="info__label">Average</div><div class="info__value" style="color:var(--accent)">${n(mean(stats.awayGates))}</div></div>
            <div class="info"><div class="info__label">Biggest</div><div class="info__value">${n(Math.max(...stats.awayGates))}</div></div>
          </div>`));
      }

      if (stats.gates.length && stats.awayGates.length) {
        const all = [...stats.gates, ...stats.awayGates];
        card.append(el(`<p class="hint">Across all ${all.length} games Kettering have played in
          front of ${n(all.reduce((a, b) => a + b, 0))} people, an average of ${n(mean(all))}.</p>`));
      }

      /* Against last season, once the archive is in. Appended rather than
         rebuilt, so the card is useful before it arrives and better after. */
      const last = el(`<div></div>`);
      card.append(last);
      ensureArchive().then(() => {
        const prev = lastSeasonGates();
        if (!prev) return;
        const nowHome = stats.gates.length ? mean(stats.gates) : null;
        const nowAway = stats.awayGates.length ? mean(stats.awayGates) : null;
        const thisComp = state.league?.competition || null;
        /* The two feeds name the same division differently: the archive says
           "Premier Central" and the table says "Southern League Premier
           Central". Compared raw, that reads as a promotion every season. */
        const sameLevel = (a, b) => {
          const tidy = (x) => String(x || "")
            .toLowerCase()
            .replace(/southern league|northern premier|isthmian|national league/g, "")
            .replace(/division|league/g, "")
            .replace(/[^a-z]/g, "");
          return tidy(a) === tidy(b);
        };
        const moved = prev.comp && thisComp && !sameLevel(prev.comp, thisComp);

        last.append(el(`<div class="events__head" style="margin-top:14px">Against ${esc(prev.season)}</div>`));
        const grid = el(`<div class="info-grid info-grid--3"></div>`);
        if (prev.home) {
          grid.append(el(`
            <div class="info"><div class="info__label">Home then</div>
              <div class="info__value">${n(prev.home)}</div></div>`));
        }
        if (prev.away) {
          grid.append(el(`
            <div class="info"><div class="info__label">Away then</div>
              <div class="info__value">${n(prev.away)}</div></div>`));
        }
        last.append(grid);
        last.append(el(`<p class="hint">Home ${gateChange(nowHome, prev.home)
          || "has nothing to compare yet"}. Away ${gateChange(nowAway, prev.away)
          || "has nothing to compare yet"}. Based on ${prev.homeGames} home and
          ${prev.awayGames} away games in ${esc(prev.season)}.${moved
            ? ` Worth noting the club was in ${esc(prev.comp)} then and ${esc(thisComp)} now, so
                the two are not quite like for like.`
            : ""}</p>`));
      }).catch(() => { /* this season stands on its own */ });

      wrap.append(card);
    }
  }

  /* ---- the squad as the club confirmed it ---- */
  const squad = confirmedSquad();
  if (squad.length && tab === "squad") {
    wrap.append(el(`<h2 class="section-title">The squad</h2>`));
    const seasonBy = Object.fromEntries(db.seasonRatings().map((r) => [r.player_name, r]));
    const card = el(`<div class="card"></div>`);

    POSITION_ORDER.forEach((code) => {
      const group = squad.filter((pl) => pl.abbrev === code);
      if (!group.length) return;
      card.append(el(`<div class="squad__head">${esc(POSITION_LABEL[code] || code)}</div>`));
      group.forEach((pl) => {
        const r = seasonBy[pl.name];
        card.append(el(`
          <div class="squad__row" data-player="${esc(pl.name)}" role="button" tabindex="0">
            <span class="squad__num">${pl.number ?? ""}</span>
            <span class="squad__name">${esc(pl.name)}${
              pl.loan
                ? ` <span class="squad__loan" title="On loan${pl.loan.from ? ` from ${esc(pl.loan.from)}` : ""}${pl.loan.until ? `, back ${esc(fmtDate(pl.loan.until, "short"))}` : ""}">Loan</span>`
                : ""
            }</span>
            ${r
              ? `<span class="squad__avg"><b>${r.average}</b>${r.matches} game${r.matches === 1 ? "" : "s"}</span>`
              : `<span class="squad__avg squad__avg--none">Not rated yet</span>`}
          </div>`));
      });
    });
    wrap.append(card);

    if (state.squad?.confirmed) {
      wrap.append(el(`<p class="note">Squad as confirmed by ${esc(state.squad.source || "the club")} on ${esc(fmtDate(state.squad.confirmed))}. Players come and go quickly at this level, so anyone named on a team sheet who is not on this list still gets rated with everyone else.</p>`));
    }
  }

  /* ---- rate a match ---- */
  if (tab !== "rate") return wrap;

  const played = ratableFixtures();
  if (!played.length) {
    wrap.append(el(`
      <div class="empty">
        <b>Nothing to rate yet</b>
        The season has not started. Ratings open as soon as the first game kicks off.
      </div>`));
    return wrap;
  }

  /* One game at a time. Six panels of sixteen players each was the bulk of the
     scrolling, and nobody is rating a match from five weeks ago. */
  played.slice(0, 3).forEach((f, i) => {
    if (i === 0) return wrap.append(ratingPanel(f));
    const later = el(`<details class="older-match"><summary>${esc(clubName(f.opponent))}, ${esc(fmtDate(f.date, "short"))}</summary></details>`);
    later.addEventListener("toggle", () => {
      if (later.open && later.children.length === 1) later.append(ratingPanel(f));
    }, { once: false });
    wrap.append(later);
  });
  return wrap;
}

/* ============================================================= match page */

/* Everything about one game in one place: the score, who scored, who was
   booked, the gate, the team sheet, the marks, and a way through to the away
   day guide and the discussion. Before this, a supporter tapping a fixture
   landed on the opposing club's page and the match detail was three menus
   away. */

function viewMatch({ id }) {
  const f = fixtures().find((x) => String(x.id) === String(id));
  const wrap = el(`<div><button class="back-link" data-nav="fixtures">\u2190 Fixtures</button></div>`);

  if (!f) {
    wrap.append(el(`<div class="empty"><b>Match not found</b>It may have been rearranged. The fixture list will have it.</div>`));
    return wrap;
  }

  const isHome = f.venue === "Home";
  const played = f.status === "played" && f.homeScore !== null;
  const ours = isHome ? f.homeScore : f.awayScore;
  const theirs = isHome ? f.awayScore : f.homeScore;
  const result = played ? (ours > theirs ? "Won" : ours < theirs ? "Lost" : "Drew") : "";

  wrap.append(el(`
    <div class="hub-hero">
      ${f.opponentCrest ? `<img class="hub-hero__crest" src="${esc(f.opponentCrest)}" alt="">` : ""}
      <div class="hub-hero__text">
        <h1>${esc(clubName(f.opponent))}</h1>
        <p>${esc(fmtDate(f.date))} \u00B7 ${esc(f.kickoff || "TBC")} \u00B7 ${isHome ? "Home" : "Away"}${
          f.competition && !/premier central/i.test(f.competition) ? ` \u00B7 ${esc(f.competition)}` : ""
        }</p>
      </div>
      ${played ? `<div class="match-score">${ours} - ${theirs}<span>${result}</span></div>` : ""}
    </div>`));

  if (!played && f.status !== "off") {
    const ko = kickoffTime(f);
    wrap.append(el(`<p class="note">${
      ko && ko.getTime() > Date.now()
        ? `Not played yet. ${esc(isHome ? `At ${KTFC.ground}` : `At ${f.team?.stadium || "their ground"}`)}.`
        : "Under way, or the result has not come through yet."
    }</p>`));
  }
  if (f.status === "off") {
    wrap.append(el(`<div class="notice notice--info">This game is ${esc((f.rawStatus || "off").toLowerCase())}.</div>`));
  }

  /* How the other lot have been going, which is the first thing anybody asks. */
  const theirForm = formFor(f.opponent);
  if (theirForm) {
    wrap.append(el(`
      <p class="opp-form">${esc(clubName(f.opponent))} last ${theirForm.length}: ${formRun(theirForm)}</p>`));
  }

  /* Commentary first when a game is on, because that is what someone opening
     this page mid match actually wants. */
  const vids = videosFor(f.id);
  const commentary = vids.find((v) => v.kind === "commentary");
  if (commentary) {
    const ko = kickoffTime(f);
    const onNow = ko && Date.now() >= ko.getTime() - LIVE_FROM_MS
      && Date.now() <= ko.getTime() + LIVE_UNTIL_MS;
    wrap.append(el(`<h2 class="section-title">${onNow ? "Commentary" : "Full commentary"}</h2>`));
    if (onNow) {
      wrap.append(el(`<p class="note" style="margin-top:0">Should be live now. The club streams most games, though not every one.</p>`));
    }
    wrap.append(videoEmbed(commentary));
  }

  const ev = matchEvents(f);
  if (ev) {
    wrap.append(el(`<h2 class="section-title">How it went</h2>`));
    wrap.append(ev);
  }

  /* Highlights and interviews for this game, under the report rather than above
     it, since they land days later. */
  const extras = vids.filter((v) => v !== commentary);
  if (extras.length) {
    wrap.append(el(`<h2 class="section-title">Watch</h2>`));
    const card = el(`<div class="card vid-list"></div>`);
    extras.forEach((v) => card.append(videoRow(v)));
    wrap.append(card);
  }

  const { players, source } = squadFor(f);
  if (players.length) {
    wrap.append(el(`<h2 class="section-title">Team sheet</h2>`));
    const card = el(`<div class="card"></div>`);
    const line = (list, heading) => {
      if (!list.length) return;
      card.append(el(`<div class="events__head">${heading}</div>`));
      list.forEach((pl) => card.append(el(`
        <div class="event" data-player="${esc(pl.name)}">
          <span class="event__icon">${pl.number ?? ""}</span>
          <span class="event__name event--ours">${esc(pl.name)}${pl.captain ? ` <span class="rating__cap">C</span>` : ""}</span>
        </div>`)));
    };
    line(players.filter((pl) => pl.started !== false), "Started");
    line(players.filter((pl) => pl.started === false), "Substitutes");
    if (source === "volunteer") card.append(el(`<p class="rating__source">Team sheet added by a volunteer.</p>`));
    wrap.append(card);
  }

  /* Marks, but only once a game has actually started. */
  if (kickoffTime(f) && kickoffTime(f).getTime() - 3 * 60 * 60 * 1000 <= Date.now() && f.status !== "off") {
    wrap.append(el(`<h2 class="section-title">Rate the players</h2>`));
    wrap.append(ratingPanel(f, { withEvents: false }));
  }

  /* For an away game the practical stuff is the reason most people opened this
     page, so it sits here rather than behind a button. A home game only needs a
     way through to read up on the visitors. */
  if (f.team && !isHome) {
    wrap.append(el(`<h2 class="section-title">Getting there</h2>`));
    wrap.append(awayEssentials(f.team));
  }

  /* Through to the rest, rather than dead-ending here. */
  const links = el(`<div class="btn-row" style="margin-top:18px"></div>`);
  if (f.team) {
    /* Ghost, not solid. The essentials are already on the page above, so this
       is a way through to the rest rather than the thing to press, and a solid
       gold button next to the discussion one drowned it out. */
    const guide = el(`<button class="btn ${isHome ? "btn--sm btn--ghost" : "btn--full btn--ghost"}">${
      isHome ? `About: ${esc(clubName(f.opponent))}` : `The full away day guide`
    }</button>`);
    guide.addEventListener("click", () => go("club", { id: f.team.id, from: isHome ? "home" : "away" }));
    links.append(guide);
  }
  /* The way through to the talking, which was a small grey button among other
     small grey buttons. On a match page it is the thing most people want. */
  const t = findThread(`post:${f.id}`) || findThread(`pre:${f.id}`);
  if (t) {
    const count = threadPosts(t.id).length;
    const talk = el(`
      <button class="btn btn--full talk-btn">
        <span class="talk-btn__icon" aria-hidden="true">\u{1F4AC}</span>
        <span class="talk-btn__text">
          <b>${t.kind === "post" ? "Reaction" : "Build-up"}</b>
          <span>${count ? `${count} post${count === 1 ? "" : "s"}, have your say` : "Be the first to say something"}</span>
        </span>
        <span class="talk-btn__go" aria-hidden="true">\u203A</span>
      </button>`);
    talk.addEventListener("click", () => go("thread", { id: t.id }));
    wrap.append(talk);
  }
  if (links.children.length) wrap.append(links);

  return wrap;
}

/** The away day in short: how far, what it costs, where to park and drink. */
function awayEssentials(t) {
  const info = infoFor(t.id);
  const card = el(`<div class="card"></div>`);

  card.append(el(`
    <div class="info-grid info-grid--4">
      <div class="info"><div class="info__label">Ground</div><div class="info__value">${esc(t.stadium)}</div></div>
      <div class="info"><div class="info__label">Distance</div><div class="info__value">${t.distanceMiles} miles</div></div>
      <div class="info"><div class="info__label">Adult</div><div class="info__value" style="color:var(--accent)">${money(t.adultPrice)}</div></div>
      <div class="info"><div class="info__label">Concession</div><div class="info__value">${money(t.concessionPrice)}</div></div>
    </div>`));

  card.append(el(`
    <div class="btn-row" style="margin-top:14px">
      <a class="btn btn--sm" href="${directionsUrl(t)}" target="_blank" rel="noopener">${ICON.route} Directions</a>
      <a class="btn btn--sm btn--ghost" href="${mapUrl(t)}" target="_blank" rel="noopener">${ICON.pin} ${esc(t.postcode)}</a>
    </div>`));

  const bits = [];
  if (t.carPark) {
    bits.push(`<div class="essential"><span class="essential__label">${ICON.car} Parking</span>
      <a class="essential__value" href="${placeUrl(t.carPark, t.carParkPostcode)}" target="_blank" rel="noopener">${esc(t.carPark)}${
        state.parking?.clubs?.[t.id]?.price ? ` \u00B7 ${esc(state.parking.clubs[t.id].price)}` : ""
      }</a></div>`);
  }
  if (t.pub) {
    bits.push(`<div class="essential"><span class="essential__label">${ICON.pint} Pub</span>
      <a class="essential__value" href="${placeUrl(t.pub, t.pubPostcode)}" target="_blank" rel="noopener">${esc(t.pub)}${t.pubPostcode ? ` \u00B7 ${esc(t.pubPostcode)}` : ""}</a></div>`);
  }
  if (bits.length) card.append(el(`<div class="essentials">${bits.join("")}</div>`));

  if (!t.groundVerified) {
    card.append(el(`<p class="hint">The exact spot is from the postcode rather than the ground itself, so check on the way.</p>`));
  }
  return card;
}

/* ============================================================ email nudge */

/**
 * Everyone who joined before the tickbox existed is opted out, which is the
 * correct default and also means nobody would ever hear about the Association.
 * So it is worth asking once. Turned down once, it stays down: a nudge that
 * keeps coming back is nagging, and consent nagged out of somebody is not
 * worth having.
 */
function consentNudge() {
  const user = db.currentUser();
  if (!user || !db.isOnline()) return null;
  if (db.emailOptIn()) return null;
  if (db.read("nudge:emails", false)) return null;

  const box = el(`
    <div class="nudge">
      <div class="nudge__mark" aria-hidden="true">${ICON.poppy}</div>
      <div class="nudge__body">
        <b>Want the occasional email?</b>
        <span>News about the app and about getting the Supporters' Association off the ground.
          Never adverts, never passed on, and one tap to stop.</span>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn--sm" data-yes>Yes, keep me posted</button>
          <button class="link-btn" data-no>No thanks</button>
        </div>
      </div>
    </div>`);

  box.querySelector("[data-yes]").addEventListener("click", () => {
    db.setEmailOptIn(true);
    db.write("nudge:emails", true);
    box.replaceChildren(el(`<p class="nudge__done">Thanks. You can stop them any time from your account.</p>`));
  });
  box.querySelector("[data-no]").addEventListener("click", () => {
    db.write("nudge:emails", true);
    box.remove();
  });
  return box;
}

/* =========================================================== privacy notice */

/* Written plainly rather than as a wall of legal text nobody reads. It has to
   say what is held, why, on what basis, how long, and how to get it back or
   get rid of it. */
function viewPrivacy() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Your data</h1>
      <p>What this site holds about you, why, and how to get rid of it.</p>
    </div>
  </div>`);

  const section = (title, body) => {
    wrap.append(el(`<h2 class="section-title">${esc(title)}</h2>`));
    const card = el(`<div class="card"></div>`);
    body.forEach((t, i) => card.append(el(`<p class="club-overview"${i ? ' style="margin-top:12px"' : ""}>${t}</p>`)));
    wrap.append(card);
  };

  section("Who runs this", [
    `This site is run by Danny Jordan for the Kettering Town FC Supporters' Association.
     If you want anything here changed or deleted, email
     <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a> and it will be done.`,
  ]);

  section("What is held", [
    `<b>If you have not made an account</b>, nothing about you personally. No advertising, and
     nothing that follows you around this site or any other. Anything you tick or pick is kept on
     your own phone and never leaves it.`,
    `<b>Page counts.</b> We count how many times each page is opened, so we know whether anybody is
     reading what we publish. That count holds no IP address, no device identifier, no account and
     no cookie: a row records only that a page was opened on a given day, and how many times.
     Whether a visit is your first that day is worked out by a date kept in your own browser and is
     never sent to us, so there is nothing here that could be traced back to you, by us or by
     anybody else.`,
    `<b>If you have made an account</b>: the name you chose, your email address, and whatever you
     have posted, predicted, rated or reported. Your email address is held by Supabase, who provide
     the sign-in, and is never shown to other supporters.`,
    `Anything you post on the fan wall, any ground or price report, and your prediction league
     entries are visible to other supporters under the name you chose. Do not put anything in a
     post you would not want a stranger to read.`,
  ]);

  section("Why, and on what basis", [
    `Your account exists so your posts, predictions and ratings follow you between devices. That is
     the service you asked for by signing up.`,
    `Emails about the app and about forming the Supporters' Association are sent only to people who
     ticked the box asking for them. That box is never ticked for you, and unticking it in your
     account stops them immediately. There are no adverts and nothing is ever sold or passed on.`,
  ]);

  section("How long", [
    `For as long as you have an account. Ask for it to be deleted and it goes, along with your
     posts, ratings and predictions.`,
  ]);

  section("What you can ask for", [
    `A copy of everything held about you, a correction, or deletion. Email
     <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a>. There is no charge and no form to fill
     in. If you are not happy with how it is handled you can complain to the Information
     Commissioner's Office at ico.org.uk.`,
  ]);

  section("Cookies and tracking", [
    `There are none. No advertising, no analytics, no third party trackers. The site stores a couple
     of things in your browser to keep you signed in and remember your theme, and that is all.`,
    `Videos are embedded from YouTube's no-cookie player, which does not set cookies until you press
     play. Maps and directions open in your own maps app rather than loading anything here.`,
  ]);

  wrap.append(section("The fan consultation", [
    "Between 17 and 21 August 2026 we asked supporters what they make of the way the club is being run. Anyone could answer, with or without an account.",
    "We keep what you chose from the lists, the confidence score you gave, and anything you typed. If you were signed in, the answer is linked to your account so you can amend it. If you were not, it is linked only to a random string kept in your browser, which exists so you are not asked twice. It is not derived from anything about you and it is never shown or published.",
    "The numbers are published as numbers. Anything you wrote is read by a volunteer before it goes anywhere, and is published only if you ticked the box saying we may, with your name only if you gave one. Questions for the club are put to them in writing.",
    "Raw responses are not handed to the club. Nobody outside the volunteers running the consultation sees them, and they are deleted once the findings are published and the questions have been answered or abandoned.",
  ]));

  wrap.append(el(`<p class="note">Last updated 22 August 2026.</p>`));
  return wrap;
}

/* ============================================================ join prompt */

/**
 * What a signed-out supporter sees on a page that needs an account. Both the
 * season tracker and the feedback form had their own version of this, and the
 * feedback one in particular read like a refusal. Saying how many people have
 * already joined does more than explaining the rule does.
 */
function joinPrompt({ heading, blurb, points = [], footer = null }) {
  const count = db.supporterCount();
  const card = el(`
    <div class="join">
      <div class="join__mark" aria-hidden="true">${ICON.poppy}</div>
      <h2 class="join__heading">${esc(heading)}</h2>
      <p class="join__blurb">${esc(blurb)}</p>
      ${points.length ? `<ul class="join__points">${points.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <button class="btn btn--full join__go" data-nav="account">Sign in or join</button>
      <p class="join__count">${
        count
          ? `Join ${count.toLocaleString("en-GB")} Poppies supporters. It takes about thirty seconds and all it needs is a name.`
          : "It takes about thirty seconds and all it needs is a name."
      }</p>
      ${footer ? `<p class="join__footer">${footer}</p>` : ""}
    </div>`);
  return card;
}

/* ================================================================== admin */

/* For whoever runs the site. Hidden from the menus and refuses to render for
   anyone else, though the real protection is in the database: the counts view
   returns nothing to a non-admin and the tag function raises rather than
   writing. This page is a convenience, not the lock. */


/* ------------------------------------------------ consultation, insights */

/* Words too ordinary to tell you anything. Deliberately long: a cloud whose
   biggest word is "the" is decoration, not information. */
const CLOUD_STOP = new Set(`
  a an the this that these those there here it its it's is are was were be been being am
  i we you he she they them us me my our your their his her him himself themselves
  and or but so if then than as at by for from in into of off on onto out over to under up
  with without within about after before during since until while when where which who whom
  what why how all any both each every few more most much no none not other same some such
  very just only also again do does did done have has had having will would could should must
  can may might shall get got go going went come came make made take taken put said say says
  need needs needed want wants wanted think thought know known feel felt seem seems look looks
  like really actually literally basically obviously clearly honestly frankly personally
  club team fc kettering town poppies latimer park ktfcsa season game games match matches
  one two three four five ten lot lots bit thing things way ways time times year years
  people person fans fan supporter supporters everyone anyone somebody nobody
  been over back down out again still even ever never always sometimes often
  many much more less most least many's several various certain particular
  january february march april june july august september october november december
  monday tuesday wednesday thursday friday saturday sunday week weeks month months
  going gone give given gets keep kept done doing being having something anything
  because though although however therefore instead rather quite pretty fairly
`.trim().split(/\s+/));

/**
 * The words supporters actually used, sized by how often.
 *
 * Built from the free text in the responses, which only a volunteer can read,
 * so this lives in the admin panel and nowhere else. It is a way of seeing a
 * hundred and forty comments at once without reading them one at a time, which
 * is the thing that stops a volunteer reading any of them properly.
 */
function wordCloud(rows) {
  const counts = new Map();
  for (const r of rows) {
    const text = [r.concern_note, r.positive_note, r.question].filter(Boolean).join(" ");
    for (const raw of text.toLowerCase().split(/[^a-z'-]+/)) {
      const w = raw.replace(/^['-]+|['-]+$/g, "");
      if (w.length < 4 || CLOUD_STOP.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const top = [...counts.entries()].filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]).slice(0, 40);
  if (top.length < 5) return null;

  const most = top[0][1];
  const card = el(`<div class="card"><div class="cloud"></div></div>`);
  const cloud = $(".cloud", card);
  /* Shuffled so the biggest words are not all bunched at the front, but seeded
     off the data so it does not jump about on every render. */
  const rnd = rngFor(`cloud:${rows.length}:${top[0][0]}`);
  seededShuffle(top, rnd).forEach(([word, n]) => {
    /* Square root, so a word used forty times is not forty times the size of
       one used once and pushing everything else off the card. */
    const size = 11 + Math.round(Math.sqrt(n / most) * 17);
    const weight = n > most * 0.5 ? 700 : n > most * 0.25 ? 600 : 400;
    cloud.append(el(`<span class="cloud__w" style="font-size:${size}px;font-weight:${weight}"
      title="${esc(word)}: ${n} time${n === 1 ? "" : "s"}">${esc(word)}</span>`));
  });
  card.append(el(`<p class="hint">The ${top.length} words supporters used most, out of
    ${rows.filter((r) => r.concern_note || r.positive_note || r.question).length} pieces of
    writing. Ordinary words are stripped out. Hover for the count.</p>`));
  return card;
}

/** Responses per day, so a volunteer can see whether it is still moving. */
function responsesByDay(rows) {
  if (!rows.length) return null;
  const byDay = new Map();
  rows.forEach((r) => {
    const d = londonStamp(new Date(r.created_at)).slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + 1);
  });
  /* Every day of the window, including any with nothing, because a flat day is
     itself worth seeing. */
  const days = [];
  for (let d = new Date(`${CONSULT_OPENS.slice(0, 10)}T12:00:00Z`);
       londonStamp(d).slice(0, 10) <= CONSULT_CLOSES.slice(0, 10);
       d = new Date(d.getTime() + 86400000)) {
    const key = londonStamp(d).slice(0, 10);
    days.push([key, byDay.get(key) || 0]);
  }
  const most = Math.max(...days.map(([, n]) => n), 1);
  const today = londonToday();
  return el(`
    <div class="card">
      ${days.map(([day, n]) => `
        <div class="dist">
          <span class="dist__key dist__key--wide">${esc(fmtDate(day, "short"))}${day === today ? " (today)" : ""}</span>
          <span class="dist__bar"><span class="dist__fill" style="width:${Math.round((n / most) * 100)}%"></span></span>
          <span class="dist__n">${n}</span>
        </div>`).join("")}
      <p class="hint">${rows.length} in total. Today is still running, so its bar will grow.</p>
    </div>`);
}

/**
 * A section that can be folded away. The consultation tab runs to twenty
 * thousand pixels once the dashboard is on it, so everything below the queue
 * is closed until somebody asks for it.
 */
function foldable(title, build, { open = false } = {}) {
  const box = el(`
    <details class="fold"${open ? " open" : ""}>
      <summary class="fold__head">${esc(title)}</summary>
      <div class="fold__body"></div>
    </details>`);
  let built = false;
  const fill = () => {
    if (built) return;
    built = true;
    const node = build();
    if (node) $(".fold__body", box).append(node);
  };
  if (open) fill();
  box.addEventListener("toggle", () => { if (box.open) fill(); });
  return box;
}


/* ------------------------------------------------ grouping the questions

   Ninety-odd questions, a great many of them the same question written
   differently. A club sent ninety-five questions answers none of them.

   Two passes, both deliberately explainable, because the grouping may have to
   be defended: topic from keyword sets, then near-duplicates within a topic by
   word overlap. It suggests; a volunteer decides. Nothing is published in a
   supporter's words without somebody agreeing them.                        */

/* The words that put a question under a theme. Scored by how many hit, so a
   term appearing in two lists is not a problem: the stronger match wins.
   Widened after the August consultation, where 46 of 109 questions fell into
   "everything else" because the lists were missing the words supporters
   actually use -- "sell" was absent from ownership and "money" from money. */
const Q_TOPICS = [
  ["volunteers", "Volunteers and staff",
   "volunteer steward resign departure sacked staff personnel stalwart leaving "
   + "left walked walking stepping stepped quit interview interviewed reinterview "
   + "replaced replacement pushed exited departed"],
  ["money", "Money and accounts",
   "account financial finance debt solvent turnover audit creditor hmrc money "
   + "fund funding cash spent spend paid payment owed owing invoice supplier "
   + "income revenue loss profit administration"],
  ["comms", "Communication and transparency",
   "communication communicate told telling inform silence statement transparency "
   + "transparent explain explanation honest honesty truth lied update announced"],
  ["ownership", "Ownership and investment",
   "owner ownership takeover consortium buyer sale sell sold buy bid offer "
   + "custodian invest investor investment shareholding akhtar"],
  ["ground", "The ground and the lease",
   "ground stadium lease latimer rockingham freehold tenancy pitch facility "
   + "floodlight toilet fence infrastructure 3g"],
  ["sponsors", "Sponsors and partners",
   "sponsor sponsorship partner commercial advertising"],
  ["football", "The team and the manager",
   "manager coach signing recruitment playing budget squad football player team"],
  ["governance", "Board and governance",
   "board director chairman committee governance agm minutes constitution trustee"],
  ["matchday", "Matchday, tickets and the bar",
   "ticket admission price programme bar turnstile matchday queue clubhouse"],
];

/* Words too ordinary to say anything. Deliberately long, and it includes the
   words that appear in every question about this club: "club", "fans" and
   "season" put a question in whichever topic listed them first. */
const Q_STOP = new Set(`
  a an the this that these those there here is are was were be been being am do does did done
  have has had having will would could should can may might must shall i we you he she they it
  us me my our your their his her its and or but so if then than as at by for from in into of
  off on onto out over to under up with without within about after before during since until
  while when where which who whom what why how all any both each every few more most much no
  none not other same some such very just only again also because though although however
  question questions ask asked asking answer answers please like want need know say said
  get got give given make made take taken go going come came use used actually
  club team fc kettering town poppies ktfcsa fan fans supporter supporters season year
  currently now still ever never really thing things lot bit way please thanks
`.trim().split(/\s+/));

/** Light stem: enough to make "volunteers" and "volunteer" the same word. */
const qStem = (w) => w
  .replace(/(ies)$/, "y")
  .replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
  .replace(/([^s])s$/, "$1")
  .replace(/(ing|ed)$/, "");

/** A question reduced to the words that carry its meaning. */
function qWords(text) {
  const out = new Set();
  for (const raw of String(text || "").toLowerCase().split(/[^a-z'-]+/)) {
    /* Apostrophes stripped before stemming, or "sponsor's" never matches
       "sponsor" and the question lands in "everything else". */
    const w = qStem(raw.replace(/'/g, "").replace(/^-+|-+$/g, ""));
    if (w.length < 3 || Q_STOP.has(w)) continue;
    out.add(w);
  }
  return out;
}

/**
 * Which theme a question is about.
 *
 * The theme is the grouping that matters. Trying to find exact near-duplicates
 * first was the wrong idea: two people asking the same thing share about a
 * quarter of their words, which is also what two unrelated questions share, so
 * the threshold that merged the right ones merged the wrong ones too. A club
 * wants a dozen questions covering what supporters asked about, not ninety-five
 * near-misses.
 */
function qTopic(words) {
  let best = "other";
  let bestScore = 0;
  for (const [key, , terms] of Q_TOPICS) {
    const set = new Set(terms.split(" ").map(qStem));
    let score = 0;
    words.forEach((w) => { if (set.has(w)) score += 1; });
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

/**
 * A first draft of each theme's question, to be edited rather than accepted.
 *
 * "Start from the themes" used to hand over empty boxes, which is the correct
 * principle -- the wording has to be the Association's, not a supporter's raw
 * sentence -- applied in the least useful way. Editing a sentence is a far
 * smaller job than facing a blank one, and it is still entirely rewritable.
 */
const Q_TOPIC_DRAFT = {
  volunteers: "How many volunteers and members of staff have left the club since June, and what was the reason in each case?",
  money: "What is the club's current financial position, and when will its accounts be published?",
  comms: "Why has the club not explained recent changes to supporters, and what will it do differently?",
  ownership: "Has the club received a formal takeover approach, and on what terms would the owner consider selling?",
  ground: "What investment is planned at the ground, how will it be funded, and what is the long-term plan for a home?",
  sponsors: "Which commercial partnerships is the club relying on, and how is that income shared across the club?",
  football: "What are the plans for the squad and the management, and what is the playing budget?",
  governance: "Who sits on the board and the committee, what is each person's role, and who takes the final decision?",
  matchday: "How are admission prices set, and what is being done about the matchday experience?",
  other: "",
};

const Q_TOPIC_LABEL = Object.fromEntries(
  [...Q_TOPICS.map(([k, l]) => [k, l]), ["other", "Everything else"]]
);

/** Jaccard: shared words over total. Used to pick a group's wording, not to form it. */
function qSimilar(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((w) => { if (b.has(w)) shared += 1; });
  return shared / (a.size + b.size - shared);
}

function earlySightPicker() {
  const { node, close } = modal(`
    <h3 style="margin-bottom:6px">Who can see it early</h3>
    <p class="hint" style="margin-bottom:12px">They get the report as supporters will see it,
      before it is published. Not the raw responses, and nothing to moderate. Volunteers already
      have it.</p>
    <div class="field"><input id="es-q" type="search" placeholder="Search supporters"
      aria-label="Search supporters"></div>
    <div id="es-list"><p class="note">Loading.</p></div>
    <p class="hint" style="margin-top:12px">Send them
      <b>fans.ktfcsa.com/#/consult/preview</b>. They need to be signed in on that device.</p>`);

  const list = node.querySelector("#es-list");
  const draw = (rows, filter = "") => {
    const want = filter.trim().toLowerCase();
    const shown = rows
      .filter((r) => !r.is_admin)
      .filter((r) => !want || (r.display_name || "").toLowerCase().includes(want))
      .sort((a, b) => Number(db.isResultsViewer(b.id)) - Number(db.isResultsViewer(a.id)));
    list.replaceChildren();
    if (!shown.length) {
      list.append(el(`<p class="note">Nobody by that name.</p>`));
      return;
    }
    shown.slice(0, 40).forEach((r) => {
      const on = db.isResultsViewer(r.id);
      const row = el(`
        <label class="offer" style="margin-bottom:6px">
          <input type="checkbox"${on ? " checked" : ""}>
          <span><b>${esc(r.display_name)}</b></span>
        </label>`);
      row.querySelector("input").addEventListener("change", async (e) => {
        const want2 = e.target.checked;
        e.target.disabled = true;
        try {
          await db.setResultsViewer(r.id, want2);
          toast(want2 ? `${r.display_name} can see it early.` : `${r.display_name} can no longer see it.`);
        } catch (err) {
          e.target.checked = !want2;
          toast(err.message || "That did not save.");
        }
        e.target.disabled = false;
      });
      list.append(row);
    });
  };

  db.adminPeople().then((rows) => {
    draw(rows);
    node.querySelector("#es-q").addEventListener("input", (e) => draw(rows, e.target.value));
  }).catch(() => {
    list.replaceChildren();
    list.append(el(`<p class="note">Could not load the supporter list.</p>`));
  });
}

/**
 * Suggests which of the agreed questions a supporter's question belongs under.
 *
 * Scored against the volunteer's own wording, the theme, and whatever is
 * already filed there, so the suggestions sharpen as the sweep goes on. It only
 * ever proposes: nothing is filed without somebody pressing something.
 */
function suggestFor(q, groups) {
  let best = null;
  let bestScore = 0;
  groups.forEach((g, i) => {
    const labelWords = qWords(g.label || "");
    let score = qSimilar(q.words, labelWords) * 2;
    if (g.topic && g.topic === q.topic) score += 0.5;
    g.members.forEach((id) => {
      const m = q.all?.get(id);
      if (m) score = Math.max(score, qSimilar(q.words, m.words));
    });
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore >= 0.12 ? best : null;
}

/**
 * The question workbench.
 *
 * Built the other way up from the first attempt. That one clustered the
 * submissions and then used the most central supporter's sentence as the
 * question, which meant the wording sent to the club was somebody's raw text,
 * typos and all, and no amount of tuning the threshold fixed it.
 *
 * So: the volunteer writes the questions, in the Association's own words. Every
 * submission is then filed under one of them. Anything not filed is not lost --
 * it goes to the club as an addendum, in full. The counter at the top is the
 * promise: filed plus addendum always equals the number asked.
 */
/**
 * The complete internal record of the consultation.
 *
 * The public report and its PDF honour consent: anything a supporter did not
 * tick the box for, and anything a volunteer held back, stays out. That is
 * right for publication and wrong for a record, so this is the other half --
 * everything, marked up with what was published and what was not.
 *
 * Two fields are deliberately absent. `device_key` identifies a browser and is
 * never shown to anyone by design; exporting it into a file that might be
 * forwarded would undo that in one step. `profile_id` would tie every answer to
 * a named account, so only whether somebody was signed in is kept. People
 * answered a survey, not a register.
 */
function internalExport(rows, groups, excludedIds) {
  const L = [];
  const held = new Set(excludedIds || []);
  const filedIn = new Map();
  (groups || []).forEach((g, i) => g.members.forEach((id) => filedIn.set(id, i + 1)));

  const list = (a) => (a && a.length ? a.join(", ") : "-");
  const yn = (b) => (b ? "yes" : "no");

  L.push("KETTERING TOWN FC SUPPORTERS' ASSOCIATION");
  L.push("Fan consultation, 17-21 August 2026 - COMPLETE INTERNAL RECORD");
  L.push(`Generated ${fmtDate(londonToday())} at ${new Date().toLocaleTimeString("en-GB")}`);
  L.push("");
  L.push("CONFIDENTIAL. This contains free text that supporters did not agree to have");
  L.push("published, and questions held back from the club. It is the record, not the");
  L.push("report. Do not circulate it.");
  L.push("");
  L.push("Device keys and account identifiers are not included: whether somebody was");
  L.push("signed in is recorded, who they were is not.");
  L.push("");
  L.push(`Responses: ${rows.length}`);

  const withQ = rows.filter((r) => r.question && r.question.trim());
  L.push(`Questions asked: ${withQ.length}`);
  if (groups && groups.length) {
    L.push(`Grouped into: ${groups.length}`);
    L.push(`Held back: ${withQ.filter((r) => held.has(r.id)).length}`);
    L.push(`To the addendum: ${withQ.filter((r) => !filedIn.has(r.id) && !held.has(r.id)).length}`);
  }
  L.push("");

  if (groups && groups.length) {
    L.push("=".repeat(70));
    L.push("THE QUESTIONS PUT TO THE CLUB, AND WHAT WAS FILED UNDER EACH");
    L.push("=".repeat(70));
    groups.forEach((g, i) => {
      L.push("");
      L.push(`${i + 1}. ${g.label || "(no wording)"}   [asked by ${g.members.length}]`);
      g.members.forEach((id) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return;
        L.push(`     - ${r.question.replace(/\s+/g, " ")}`);
        L.push(`       (${r.question_status}${r.publish_ok ? "" : ", no consent to publish"}${
          r.attribution ? `, from ${r.attribution}` : ""})`);
      });
    });
    L.push("");
    const add = withQ.filter((r) => !filedIn.has(r.id) && !held.has(r.id));
    if (add.length) {
      L.push("-".repeat(70));
      L.push(`ADDENDUM - sent to the club in full (${add.length})`);
      L.push("-".repeat(70));
      add.forEach((r, i) => L.push(`A${i + 1}. ${r.question.replace(/\s+/g, " ")}`));
      L.push("");
    }
    const back = withQ.filter((r) => held.has(r.id));
    if (back.length) {
      L.push("-".repeat(70));
      L.push(`HELD BACK - not sent, not published (${back.length})`);
      L.push("-".repeat(70));
      back.forEach((r, i) => L.push(`H${i + 1}. ${r.question.replace(/\s+/g, " ")}`));
      L.push("");
    }
  }

  L.push("=".repeat(70));
  L.push("EVERY RESPONSE IN FULL");
  L.push("=".repeat(70));
  [...rows].reverse().forEach((r, i) => {
    L.push("");
    L.push(`--- ${i + 1} of ${rows.length} --- ${new Date(r.created_at).toLocaleString("en-GB")}`);
    L.push(`Signed in: ${yn(r.profile_id)}   Consent to publish: ${yn(r.publish_ok)}${
      r.attribution ? `   Name given: ${r.attribution}` : ""}`);
    L.push(`Confidence: ${r.confidence}/10   Direction: ${r.direction}   Meeting: ${r.meeting || "-"}`);
    L.push(`Represented by: ${Object.entries(r.representation || {})
      .map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
    L.push(`Positives: ${list(r.positives)}`);
    L.push(`Concerns: ${list(r.concerns)}`);
    L.push(`Would support: ${list(r.actions)}`);
    if (r.positive_note) L.push(`What works [${r.note_status}]: ${r.positive_note.replace(/\s+/g, " ")}`);
    if (r.concern_note)  L.push(`What worries [${r.note_status}]: ${r.concern_note.replace(/\s+/g, " ")}`);
    if (r.question) {
      const where = filedIn.has(r.id) ? `filed under Q${filedIn.get(r.id)}`
        : held.has(r.id) ? "HELD BACK" : "addendum";
      L.push(`Question [${r.question_status}, ${where}]: ${r.question.replace(/\s+/g, " ")}`);
    }
  });
  L.push("");
  L.push(`End of record. ${rows.length} responses.`);
  return L.join("\n");
}

/** Hands a generated file to the browser, falling back to something copyable. */
async function offerFile(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    /* Some browsers refuse a script-started download. Show it instead. */
    modal(`<h3 style="margin-bottom:6px">${esc(name)}</h3>
      <p class="hint" style="margin-bottom:10px">The download was refused. Press and hold to copy.</p>
      <textarea readonly rows="16" style="width:100%">${esc(text)}</textarea>`);
    return false;
  }
}

/**
 * Reads a prepared list: the agreed wording for each question, which
 * submissions belong under it, and which are held back.
 *
 * Typing ten long questions and filing a hundred submissions by hand on a
 * phone is not a job anybody should be asked to do twice, and the filing is
 * decided away from the screen anyway. Positions refer to the numbering in
 * "Copy all questions", so the paste is checked against the total before it is
 * allowed to touch anything: if a response arrived after that export every
 * number would be off by one, and silently misfiling a hundred questions is
 * far worse than refusing.
 *
 * Format, one per line:
 *   TOTAL 109
 *   Q1 | 1,2,4,12 | The agreed wording of the question
 *   HOLD | 5,8,25
 */
function parsePreparedList(text, asked) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = { groups: [], hold: [], errors: [] };
  let declared = null;

  lines.forEach((line) => {
    const total = line.match(/^TOTAL\s+(\d+)$/i);
    if (total) { declared = Number(total[1]); return; }

    const parts = line.split("|").map((x) => x.trim());
    const head = (parts[0] || "").toUpperCase();

    const nums = (parts[1] || "").split(/[,\s]+/).filter(Boolean).map(Number);
    const bad = nums.filter((n) => !Number.isInteger(n) || n < 1 || n > asked.length);
    if (bad.length) out.errors.push(`${head}: ${bad.join(", ")} out of range`);
    const ids = nums.filter((n) => !bad.includes(n)).map((n) => asked[n - 1].id);

    if (head === "HOLD") { out.hold.push(...ids); return; }
    if (/^Q\d+$/.test(head)) {
      const label = parts.slice(2).join(" | ").trim();
      if (!label) out.errors.push(`${head} has no wording`);
      out.groups.push({ label, topic: "other", members: ids, wording: [] });
      return;
    }
    out.errors.push(`Could not read: ${line.slice(0, 40)}`);
  });

  if (declared === null) out.errors.push("No TOTAL line, so the numbering cannot be checked.");
  else if (declared !== asked.length) {
    out.errors.push(`TOTAL says ${declared} but there are ${asked.length} questions. `
      + `The numbering would not line up, so nothing has been changed.`);
  }

  const seen = new Set();
  [...out.groups.flatMap((g) => g.members), ...out.hold].forEach((id) => {
    if (seen.has(id)) out.errors.push("The same question is filed twice.");
    seen.add(id);
  });
  out.filed = seen.size;
  return out;
}

/**
 * Who is looking, and at what.
 *
 * Counters only. Nothing here can be traced to a person because nothing about
 * a person was ever collected: see the note on page_views in the schema. The
 * numbers are indicative rather than audited, which is said on the pane so
 * nobody quotes them as though they were.
 */
function viewsPane() {
  const box = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);

  db.viewStats(30).then((rows) => {
    box.replaceChildren();
    if (!rows.length) {
      box.append(el(`<div class="empty"><b>Nothing counted yet</b>Views start being counted from
        the next time somebody opens the app.</div>`));
      return;
    }

    const today = londonToday();
    const byDay = new Map();
    const byRoute = new Map();
    rows.forEach((r) => {
      const d = byDay.get(r.day) || { views: 0, uniques: 0 };
      d.views += r.views; d.uniques += r.uniques;
      byDay.set(r.day, d);
      const t = byRoute.get(r.route) || { views: 0, uniques: 0 };
      t.views += r.views; t.uniques += r.uniques;
      byRoute.set(r.route, t);
    });

    const totals = [...byDay.values()].reduce(
      (a, d) => ({ views: a.views + d.views, uniques: a.uniques + d.uniques }),
      { views: 0, uniques: 0 });
    const now = byDay.get(today) || { views: 0, uniques: 0 };

    box.append(el(`
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Today</div>
          <div class="info__value" style="color:var(--accent)">${now.views}</div></div>
        <div class="info"><div class="info__label">Today, first look</div>
          <div class="info__value">${now.uniques}</div></div>
        <div class="info"><div class="info__label">30 days</div>
          <div class="info__value">${totals.views}</div></div>
        <div class="info"><div class="info__label">30 days, first looks</div>
          <div class="info__value">${totals.uniques}</div></div>
      </div>`));

    /* Day by day, most recent first, so a spike after a post is obvious. */
    const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
    const topDay = Math.max(...days.map(([, d]) => d.views), 1);
    box.append(el(`<div class="events__head" style="margin-top:14px">By day</div>`));
    days.forEach(([day, d]) => {
      box.append(el(`
        <div class="dist">
          <span class="dist__key dist__key--wide">${esc(fmtDate(day, "short"))}${
            day === today ? " (so far)" : ""}</span>
          <span class="dist__bar"><span class="dist__fill" style="width:${
            Math.round((d.views / topDay) * 100)}%"></span></span>
          <span class="dist__n">${d.views}<span style="color:var(--text-3)"> / ${d.uniques}</span></span>
        </div>`));
    });

    const pages = [...byRoute.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 12);
    const topPage = Math.max(...pages.map(([, t]) => t.views), 1);
    box.append(el(`<div class="events__head" style="margin-top:14px">Most looked at</div>`));
    pages.forEach(([route, t]) => {
      const label = route === "consult-preview" ? "Report preview"
        : ROUTES[route]?.label || route;
      box.append(el(`
        <div class="dist">
          <span class="dist__key dist__key--wide">${esc(label)}</span>
          <span class="dist__bar"><span class="dist__fill" style="width:${
            Math.round((t.views / topPage) * 100)}%"></span></span>
          <span class="dist__n">${t.views}</span>
        </div>`));
    });

    box.append(el(`<p class="hint">Each figure is views, then the number of browsers whose first
      look that day it was. Nothing about anybody is stored: "first look" is decided by a date kept
      in the visitor's own browser and never sent here, so clearing storage or using a second
      browser counts twice. Treat these as a floor, not a measurement.</p>`));
  }).catch((err) => {
    box.replaceChildren();
    box.append(el(`<div class="empty"><b>Could not load</b>${esc(err.message || "Try again.")}</div>`));
  });

  return box;
}

/**
 * A way through to Cloudflare's own figures.
 *
 * Not embedded, and not for want of trying. Reading them needs an API token,
 * and a token cannot live in the app because everything the app ships is
 * public. The usual answer is a small server-side function, but this site is a
 * Worker serving static assets rather than a Pages project, so there is no
 * functions/ directory convention to drop one into. Doing it properly means
 * adding a Worker entry point and a wrangler config to a deployment that
 * currently works, which is not a thing to attempt casually on a live site.
 *
 * So: a link, and our own counts above it, which cover the question most of
 * the time.
 */
function cloudflarePane() {
  return el(`
    <div class="card">
      <p class="club-overview">Cloudflare counts every request at the edge, including people who
      left before the app finished loading, and it has been counting since long before our own
      counter existed. It is the place to look for the nights we have no figures for.</p>
      <div class="btn-row" style="margin-top:12px">
        <a class="btn btn--sm btn--ghost" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages"
           target="_blank" rel="noopener">${ICON.globe} Open Cloudflare</a>
      </div>
      <p class="hint">Web Analytics, then the site for fans.ktfcsa.com. Bringing these numbers into
      this page would mean an API token, and a token in the app is a token given to everybody who
      opens it. It can be done through a Worker route if it is worth doing.</p>
    </div>`);
}

/**
 * Where the consultation has actually got to, in one panel.
 *
 * The tab had all of this in it already, spread across five cards and two
 * foldables, so answering "have the questions gone yet" meant scrolling and
 * remembering. Each tile is a button into the part it describes.
 */
function consultStatusBoard(goTo) {
  const box = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);

  Promise.all([
    db.consultationResults().catch(() => null),
    db.pendingActions().catch(() => null),
    db.publishedQuestions().catch(() => []),
    db.consultationPublished().catch(() => null),
  ]).then(([res, pending, groups, pub]) => {
    box.replaceChildren();
    const responses = res?.summary?.responses || 0;
    const asked = res?.summary?.questions_asked || 0;
    const waiting = pending?.consultation || 0;
    const isPublic = Boolean(pub?.results_public);
    const sentAt = groups.find((g) => g.asked_at)?.asked_at;
    const answered = groups.filter((g) => g.answered_at).length;
    const days = sentAt
      ? Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000) : null;

    const tile = (label, value, tone, to) => {
      const b = el(`
        <button class="board__tile${tone ? ` board__tile--${tone}` : ""}" type="button">
          <span class="board__label">${esc(label)}</span>
          <span class="board__value">${value}</span>
        </button>`);
      if (to) b.addEventListener("click", () => goTo(to));
      else b.disabled = true;
      return b;
    };

    const grid = el(`<div class="board"></div>`);
    grid.append(tile("Responses", responses, "", "a-live"));
    grid.append(tile("Waiting to be read", waiting, waiting ? "warn" : "good", "a-queue"));
    grid.append(tile("Questions asked", asked, "", "a-questions"));
    grid.append(tile(
      groups.length ? "Questions agreed" : "Questions not agreed",
      groups.length || "\u2014",
      groups.length ? "good" : "warn", "a-questions"));
    grid.append(tile(
      sentAt ? "Sent to the club" : "Not sent yet",
      sentAt ? `${days}d` : "\u2014",
      sentAt ? "good" : "warn", "a-questions"));
    grid.append(tile(
      isPublic ? "Published" : "Not published",
      isPublic ? "\u2713" : "\u2014",
      isPublic ? "good" : "warn", "a-publish"));
    box.append(grid);

    /* One line saying what to do next, because six tiles state a position and
       none of them states a move. */
    let next = "";
    if (waiting) next = `${waiting} comment${waiting === 1 ? "" : "s"} still to read.`;
    else if (!groups.length) next = "Agree the questions, then save them as final.";
    else if (!sentAt) next = "Send the email, then press Mark as sent to start the clock.";
    else if (!isPublic) next = "The questions have gone. Publish the findings when you are ready.";
    else if (answered < groups.length) {
      next = `${groups.length - answered} of ${groups.length} still unanswered after ${days} day${
        days === 1 ? "" : "s"}.`;
    } else next = "Every question has been answered.";
    box.append(el(`<p class="board__next">${esc(next)}</p>`));
  }).catch(() => {
    box.replaceChildren();
    box.append(el(`<p class="note" style="margin:0">Could not read where things are up to.</p>`));
  });

  return box;
}

function questionWorkbench(rows) {
  const box = el(`<div class="card"></div>`);
  const asked = rows
    .filter((r) => r.question && r.question.trim())
    .map((r) => {
      const text = r.question.trim();
      const words = qWords(text);
      return { id: r.id, text, words, topic: qTopic(words),
               approved: r.question_status === "approved" };
    });

  if (!asked.length) {
    box.append(el(`<p class="note" style="margin:0">No questions yet.</p>`));
    return box;
  }
  const byId = new Map(asked.map((q) => [q.id, q]));
  asked.forEach((q) => { q.all = byId; });

  state.questionGroups = state.questionGroups || [];
  let groups = state.questionGroups;
  /* Held back on purpose. Unfiled means "goes to the club in the addendum", so
     without this there is no way to drop something: an allegation nobody wants
     to put their name to would ride along in the addendum unnoticed. Excluded
     questions are still counted, so the arithmetic at the top stays honest. */
  const excluded = new Set(state.qExcluded || []);
  let tab = state.qTab || "list";
  let onlyUnfiled = state.qUnfiled !== false;

  /* Groups already saved have to be read back, or the workbench starts empty on
     every reload, shows the "start from the themes" screen, and returns from
     that branch before the row carrying Save, Copy and Mark as sent. The work
     looked lost and the controls looked gone. */
  let loading = false;
  const loadSaved = () => {
    if (loading || groups.length || state.groupsLoaded) return;
    loading = true;
    db.questionGroups().then((rows) => {
      loading = false;
      state.groupsLoaded = true;
      if (rows.length) {
        groups = state.questionGroups = rows
          .slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((r) => ({
            label: r.label || "",
            topic: r.topic || "other",
            members: Array.isArray(r.members) ? r.members : [],
            wording: [],
            asked_at: r.asked_at,
            replied_at: r.replied_at,
            reply_note: r.reply_note || "",
            answered_at: r.answered_at,
            origin: r.origin || "supporters",
          }));
      }
      draw();
    }).catch((err) => {
      loading = false;
      state.groupsLoaded = true;
      console.warn("Saved question groups could not be read:", err);
      draw();
    });
  };

  const filedIds = () => new Set(groups.flatMap((g) => g.members));
  const draw = () => {
    box.replaceChildren();
    const filed = filedIds();
    const loose = asked.filter((q) => !filed.has(q.id) && !excluded.has(q.id));
    const held = asked.filter((q) => !filed.has(q.id) && excluded.has(q.id));

    /* The arithmetic, at the top, always. */
    box.append(el(`
      <div class="sweep-count">
        <b>${asked.length}</b> asked &middot;
        <b>${filed.size}</b> filed under ${groups.length} question${groups.length === 1 ? "" : "s"} &middot;
        <b>${loose.length}</b> to the addendum &middot;
        <b>${held.length}</b> held back &middot;
        <span style="color:${filed.size + loose.length + held.length === asked.length
          ? "var(--accent)" : "var(--red-400)"}">${
          filed.size + loose.length + held.length === asked.length
            ? "all accounted for" : "DOES NOT ADD UP"}</span>
      </div>`));

    /* Getting all of them out in one go: for a second pair of eyes, for a
       backup, and because reading ninety questions in a scrolling panel on a
       phone is not how anybody should be deciding what to ask a football club. */
    const dump = el(`<button class="btn btn--sm btn--ghost" style="margin-bottom:10px">Copy all ${asked.length} questions</button>`);
    dump.addEventListener("click", async () => {
      const text = asked
        .map((q, i) => `${i + 1}. [${Q_TOPIC_LABEL[q.topic] || q.topic}]${
          q.approved ? "" : " (not approved)"} ${q.text.replace(/\s+/g, " ")}`)
        .join("\n");
      const ok = await copyText(text);
      if (ok) return toast(`${asked.length} questions copied.`);
      modal(`<h3 style="margin-bottom:10px">Every question asked</h3>
        <p class="hint" style="margin-bottom:10px">Press and hold to copy.</p>
        <textarea readonly rows="14" style="width:100%">${esc(text)}</textarea>`);
    });
    box.append(dump);

    const tabs = el(`
      <div class="chips__row" style="margin-bottom:12px">
        <button class="chip${tab === "list" ? " is-on" : ""}" data-tab="list">The list <span>${groups.length}</span></button>
        <button class="chip${tab === "sweep" ? " is-on" : ""}" data-tab="sweep">Sweep <span>${loose.length}</span></button>
      </div>`);
    tabs.querySelectorAll("[data-tab]").forEach((b) => {
      b.addEventListener("click", () => { tab = state.qTab = b.dataset.tab; draw(); });
    });
    box.append(tabs);

    if (tab === "list") drawList(loose, held);
    else drawSweep(loose, held);
  };

  /* Paste a list worked out away from the screen. */
  const loadBtn = () => {
    const b = el(`<button class="btn btn--sm btn--ghost">Load a prepared list</button>`);
    b.addEventListener("click", () => {
      const { node, close } = modal(`
        <h3 style="margin-bottom:6px">Load a prepared list</h3>
        <p class="hint" style="margin-bottom:10px">One line per question, numbers referring to
          "Copy all questions". Anything not listed goes to the addendum.</p>
        <textarea id="q-paste" rows="12" style="width:100%"
          placeholder="TOTAL ${asked.length}&#10;Q1 | 1,2,4 | The wording of the question&#10;HOLD | 5,8"></textarea>
        <div id="q-paste-msg"></div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn--sm" data-go>Check it</button>
          <button class="btn btn--sm btn--ghost" data-cancel>Cancel</button>
        </div>`);
      node.querySelector("[data-cancel]").addEventListener("click", close);
      node.querySelector("[data-go]").addEventListener("click", () => {
        const msg = node.querySelector("#q-paste-msg");
        const res = parsePreparedList(node.querySelector("#q-paste").value, asked);
        msg.replaceChildren();
        if (res.errors.length) {
          msg.append(el(`<div class="empty" style="margin-top:10px"><b>Not loaded</b>${
            res.errors.map((e) => esc(e)).join("<br>")}</div>`));
          return;
        }
        const addendum = asked.length - res.filed;
        msg.append(el(`<p class="hint" style="margin-top:10px"><b>${res.groups.length}</b> questions,
          <b>${res.filed - res.hold.length}</b> filed, <b>${addendum}</b> to the addendum,
          <b>${res.hold.length}</b> held back. This replaces whatever is here now.</p>`));
        const go = el(`<button class="btn btn--sm" style="margin-top:8px">Apply it</button>`);
        go.addEventListener("click", () => {
          groups = state.questionGroups = res.groups;
          excluded.clear();
          res.hold.forEach((id) => excluded.add(id));
          state.qExcluded = [...excluded];
          close();
          draw();
          toast(`${res.groups.length} questions loaded.`);
        });
        msg.append(go);
      });
    });
    return b;
  };

  /* ------------------------------------------------------------ the list */
  const drawList = (loose, held) => {
    if (!groups.length && (loading || !state.groupsLoaded)) {
      box.append(el(`<p class="note" style="margin:0">Reading the saved list.</p>`));
      return;
    }
    if (!groups.length) {
      box.append(el(`
        <p class="hint">Write the questions you want answered, in your words. Ten is about right:
        a club sent ninety answers none. Then file every supporter's question under one of them, and
        anything that does not fit goes to the club as an addendum rather than being dropped.</p>`));
      const seedRow = el(`<div class="btn-row" style="margin-bottom:12px"></div>`);
      const seed = el(`<button class="btn btn--sm">Start from the themes</button>`);
      seed.addEventListener("click", () => {
        const tally = new Map();
        asked.forEach((q) => tally.set(q.topic, [...(tally.get(q.topic) || []), q.id]));
        groups = state.questionGroups = [...tally.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([topic, ids]) => ({
            label: Q_TOPIC_DRAFT[topic] || "", topic, members: ids, wording: [],
          }));
        draw();
      });
      const blank = el(`<button class="btn btn--sm btn--ghost">Start from nothing</button>`);
      blank.addEventListener("click", () => {
        groups = state.questionGroups = [{ label: "", topic: "other", members: [], wording: [] }];
        draw();
      });
      seedRow.append(seed, blank, loadBtn());
      box.append(seedRow);
      box.append(el(`<p class="hint" style="margin-top:0">Starting from the themes files every
        question under its theme and puts a rough first line in each, so you are editing wording
        rather than facing a blank box. Every word of it is yours to change, and themes nobody
        asked about are not created at all.</p>`));
      return;
    }

    groups.forEach((g, i) => {
      const mine = g.members.map((id) => byId.get(id)).filter(Boolean);
      const publishable = mine.filter((m) => m.approved).length;
      const card = el(`
        <div class="qgroup">
          <div class="qgroup__meta">
            <span class="pill pill--gold">${i + 1}</span>
            <span class="pill">${esc(Q_TOPIC_LABEL[g.topic] || "Mixed")}</span>
            <span class="pill">${mine.length} asked</span>
            <span class="pill">${publishable} publishable</span>
            <span class="pill${g.label.trim().length > 1200 ? " pill--warn" : ""}"
              data-len>${g.label.trim().length}</span>
          </div>
          <textarea class="qgroup__label" rows="2" placeholder="Write the question in your words"
            aria-label="Question ${i + 1}">${esc(g.label)}</textarea>
          <details class="qgroup__src">
            <summary>What supporters wrote (${mine.length})</summary>
            <div>${mine.map((m) => `<p${m.approved ? "" : ' class="q-unapproved"'}>${esc(m.text)}${
              m.approved ? "" : " <em>(not approved for publication)</em>"
            }</p>`).join("") || "<p class=\"note\">Nothing filed here yet.</p>"}</div>
          </details>
          <div class="btn-row">
            <button class="btn btn--sm btn--ghost" data-act="up">Up</button>
            <button class="btn btn--sm btn--ghost" data-act="empty">Unfile all</button>
            <button class="btn btn--sm btn--ghost" data-act="drop">Delete</button>
          </div>
          ${g.asked_at ? `
            <div class="qgroup__reply">
              <div class="qgroup__reply-head">Where this one stands</div>
              <div class="btn-row">
                <button class="btn btn--sm${g.replied_at && !g.answered_at ? "" : " btn--ghost"}"
                  data-act="replied">${g.replied_at ? "Replied" : "Mark replied"}</button>
                <button class="btn btn--sm${g.answered_at ? "" : " btn--ghost"}"
                  data-act="answered">${g.answered_at ? "Answered" : "Mark answered"}</button>
                ${g.replied_at || g.answered_at
                  ? `<button class="link-btn" data-act="clear-reply">Still waiting</button>` : ""}
              </div>
              <input class="input qgroup__note" maxlength="400" placeholder="One line on what they said, published under the question"
                value="${esc(g.reply_note || "")}">
              <p class="hint">Answered means they wrote back with an answer to it. A reply that
                does not answer it is a reply, and the question keeps counting.</p>
            </div>` : ""}
        </div>`);
      card.querySelector(".qgroup__label").addEventListener("input", (e) => {
        g.label = e.target.value;
        const n = g.label.trim().length;
        const pill = card.querySelector("[data-len]");
        pill.textContent = n;
        pill.classList.toggle("pill--warn", n > 1200);
      });
      card.querySelector('[data-act="up"]').addEventListener("click", () => {
        if (i === 0) return;
        [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
        draw();
      });
      card.querySelector('[data-act="empty"]').addEventListener("click", () => {
        g.members = []; draw();
      });

      /* Answering implies they replied, so marking answered stamps both rather
         than leaving a question that was answered but apparently never
         replied to. */
      card.querySelector('[data-act="replied"]')?.addEventListener("click", () => {
        g.replied_at = g.replied_at ? null : new Date().toISOString();
        if (!g.replied_at) g.answered_at = null;
        draw();
      });
      card.querySelector('[data-act="answered"]')?.addEventListener("click", () => {
        if (g.answered_at) {
          g.answered_at = null;
        } else {
          g.answered_at = new Date().toISOString();
          g.replied_at = g.replied_at || g.answered_at;
        }
        draw();
      });
      card.querySelector('[data-act="clear-reply"]')?.addEventListener("click", () => {
        g.replied_at = null; g.answered_at = null; draw();
      });
      card.querySelector(".qgroup__note")?.addEventListener("input", (e) => {
        g.reply_note = e.target.value;
      });
      card.querySelector('[data-act="drop"]').addEventListener("click", () => {
        /* Deleting a question must not delete what was filed under it: those
           submissions fall back to the addendum, which is the whole point. */
        groups.splice(i, 1); draw();
      });
      box.append(card);
    });

    const tools2 = el(`<div class="btn-row" style="margin-bottom:12px"></div>`);
    tools2.append(loadBtn());
    box.append(tools2);

    const add = el(`<button class="btn btn--sm btn--ghost" style="margin-bottom:12px">Add another question</button>`);
    add.addEventListener("click", () => {
      groups.push({ label: "", topic: "other", members: [], wording: [] });
      draw();
    });
    box.append(add);

    if (loose.length) {
      box.append(el(`<p class="hint">${loose.length} still unfiled. They will go to the club as an
        addendum unless you file them under the Sweep tab.</p>`));
    }
    box.append(saveRow(loose, held));
  };

  /* ---------------------------------------------------------- the sweep */
  const drawSweep = (loose, held) => {
    if (!groups.length) {
      box.append(el(`<p class="hint">Write at least one question on the list tab first.</p>`));
      return;
    }
    const filed = filedIds();
    const shown = onlyUnfiled ? [...loose, ...held] : asked;

    const filt = el(`
      <label class="offer" style="margin-bottom:10px">
        <input type="checkbox"${onlyUnfiled ? " checked" : ""}>
        <span>Only show what is still unfiled</span>
      </label>`);
    filt.querySelector("input").addEventListener("change", (e) => {
      onlyUnfiled = state.qUnfiled = e.target.checked; draw();
    });
    box.append(filt);

    if (!shown.length) {
      box.append(el(`<div class="empty"><b>Everything is filed</b>Nothing is heading for the
        addendum.</div>`));
      box.append(saveRow(loose, held));
      return;
    }

    shown.slice(0, 60).forEach((q) => {
      const here = groups.findIndex((g) => g.members.includes(q.id));
      const hint = here === -1 ? suggestFor(q, groups) : null;
      const row = el(`
        <div class="sweep">
          <p class="sweep__text">${esc(q.text)}</p>
          <div class="chips__row sweep__to"></div>
        </div>`);
      const to = row.querySelector(".sweep__to");
      groups.forEach((g, i) => {
        const on = here === i;
        const b = el(`
          <button class="chip${on ? " is-on" : ""}${hint === i ? " chip--hint" : ""}"
            title="${esc(g.label || `Question ${i + 1}`)}">${i + 1}${
              hint === i && !on ? " <span>likely</span>" : ""
            }</button>`);
        b.addEventListener("click", () => {
          groups.forEach((o) => { o.members = o.members.filter((x) => x !== q.id); });
          excluded.delete(q.id);
          state.qExcluded = [...excluded];
          if (!on) g.members.push(q.id);
          draw();
        });
        to.append(b);
      });
      const isHeld = excluded.has(q.id);
      const none = el(`<button class="chip${here === -1 && !isHeld ? " is-on" : ""}">Addendum</button>`);
      none.addEventListener("click", () => {
        groups.forEach((o) => { o.members = o.members.filter((x) => x !== q.id); });
        excluded.delete(q.id);
        state.qExcluded = [...excluded];
        draw();
      });
      to.append(none);

      const drop = el(`<button class="chip chip--held${isHeld ? " is-on" : ""}">Hold back</button>`);
      drop.addEventListener("click", () => {
        groups.forEach((o) => { o.members = o.members.filter((x) => x !== q.id); });
        isHeld ? excluded.delete(q.id) : excluded.add(q.id);
        state.qExcluded = [...excluded];
        draw();
      });
      to.append(drop);
      box.append(row);
    });
    if (shown.length > 60) {
      box.append(el(`<p class="hint">Showing 60 of ${shown.length}. File these and the rest follow.</p>`));
    }
    box.append(saveRow(loose, held));
  };

  /* --------------------------------------------------------- save / copy */
  const saveRow = (loose, held) => {
    const wrap2 = el(`<div></div>`);
    const row = el(`
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn--sm" data-act="final">Save as the final list</button>
        <button class="btn btn--sm btn--ghost" data-act="preview">Preview the questions</button>
        <button class="btn btn--sm btn--ghost" data-act="copy">Copy the questions</button>
        <button class="btn btn--sm btn--ghost" data-act="sent">Mark as sent</button>
        <button class="btn btn--sm btn--ghost" data-act="record">Download the full record</button>
      </div>`);

    const Q_MAX = 1200;
    const ready = () => groups.filter((g) => g.label.trim().length >= 8);
    /* The database enforces this too. Finding out from a raw constraint error
       while trying to save the finished list is no way to be told. */
    const tooLong = () => groups
      .map((g, i) => ({ n: i + 1, len: g.label.trim().length }))
      .filter((g) => g.len > Q_MAX);

    /* A fortnight is long enough that "we needed time" is not an answer, and
       short enough that the countdown means something. Nudged off a weekend,
       because a deadline nobody is at work for invites a late reply. */
    if (!state.qReplyBy) {
      const d = new Date(`${londonToday()}T12:00`);
      d.setDate(d.getDate() + 14);
      if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      if (d.getDay() === 6) d.setDate(d.getDate() + 2);
      state.qReplyBy = d.toISOString().slice(0, 10);
    }

    /* One builder for the preview and the real thing. If they came from
       separate code the preview would stop being a preview the first time one
       of them was edited. */
    const buildText = async (clean) => {
      const total = (await db.consultationResults())?.summary?.responses || asked.length;
      const lines = [
        `Kettering Town FC Supporters' Association`,
        `Questions from supporters, ${fmtDate(londonToday())}`,
        ``,
        `${total} supporters took part in an independent consultation between 17 and 21 August.`,
        `${asked.length} of them asked a question. Those have been grouped into the ${clean.length}`,
        `questions below, with the number of supporters who asked each one.`,
        ``,
        ...clean.map((g, i) => `${i + 1}. ${g.label.trim()}  (asked by ${g.members.length})`),
      ];
      if (loose.length) {
        /* Whole words only, so redacting "Brad" does not maul "Bradford". */
        const names = (state.qRedact || "").split(",").map((n) => n.trim()).filter(Boolean);
        const redact = (t) => names.reduce(
          (acc, n) => acc.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
                                 "[name removed]"), t);
        lines.push(
          ``,
          `Addendum: ${loose.length} question${loose.length === 1 ? "" : "s"} that did not fall`,
          `under any of the above. They are reproduced here in supporters' own words so that`,
          `nothing asked is left out.${names.length
            ? ` Names of people not connected to the club's management have been removed.` : ""}`,
          ``,
          ...loose.map((q, i) => `A${i + 1}. ${redact(q.text.replace(/\s+/g, " "))}`),
        );
      }
      lines.push(
        ``,
        `We would ask for a reply by ${fmtDate(state.qReplyBy)}.`,
        ``,
        `We will publish which of these have been answered, and how long any unanswered`,
        `question has been outstanding. That page updates itself, so a question left`,
        `unanswered is counted in days rather than raised again.`,
      );
      return lines.join("\n");
    };

    row.querySelector('[data-act="final"]').addEventListener("click", async () => {
      const clean = ready();
      if (!clean.length) return toast("Write at least one question first.");
      if (clean.length !== groups.length) {
        return toast(`${groups.length - clean.length} question${
          groups.length - clean.length === 1 ? " has" : "s have"} no wording yet.`);
      }
      const over = tooLong();
      if (over.length) {
        return toast(`Question ${over.map((o) => `${o.n} (${o.len})`).join(", ")} too long. `
          + `The limit is ${Q_MAX} characters.`);
      }
      try {
        await db.saveQuestionGroups(clean.map((g, i) => ({
          label: g.label.trim(), topic: g.topic, members: g.members, sort: i, status: "final",
        })));
        toast(`${clean.length} questions saved as final.`);
      } catch (err) {
        toast(err.message || "That did not save.");
      }
    });

    /* Read it before it goes. Touches nothing: no clock, no clipboard. */
    row.querySelector('[data-act="preview"]').addEventListener("click", async () => {
      const clean = ready();
      if (!clean.length) return toast("Write at least one question first.");
      const text = await buildText(clean);
      modal(`
        <h3 style="margin-bottom:6px">Preview</h3>
        <p class="hint" style="margin-bottom:10px">Exactly what "Copy the questions" puts on the
          clipboard, for you to write the email around. Nothing is sent from here.</p>
        <textarea readonly rows="16" style="width:100%">${esc(text)}</textarea>
        <p class="hint" style="margin-top:8px">${clean.length} questions &middot;
          ${loose.length} in the addendum &middot; ${held.length} held back and not included.</p>`);
    });

    /* Copying is just copying. The app does not send anything: the email is
       written by a person, so the clock starts when they say it went, not when
       text reached a clipboard. */
    row.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      const clean = ready();
      if (!clean.length) return toast("Write at least one question first.");
      const text = await buildText(clean);
      const ok = await copyText(text);
      if (ok) return toast("Copied. Write your email, then press Mark as sent.");
      modal(`<h3 style="margin-bottom:6px">Questions for the club</h3>
        <p class="hint" style="margin-bottom:10px">Press and hold to copy.</p>
        <textarea readonly rows="14" style="width:100%">${esc(text)}</textarea>`);
    });

    /* The one act with a public consequence: the results page starts counting
       days against the club from here, so it is deliberate and separate. */
    row.querySelector('[data-act="sent"]').addEventListener("click", () => {
      const clean = ready();
      if (!clean.length) return toast("Write at least one question first.");
      const { node, close } = modal(`
        <h3 style="margin-bottom:6px">Have the questions gone to the club?</h3>
        <p class="hint" style="margin-bottom:12px">Only press this once your email has actually
          been sent. It starts the public clock counting the days each of the ${clean.length}
          questions goes unanswered, and that is shown to supporters.</p>
        <div class="btn-row">
          <button class="btn btn--sm" data-yes>Yes, it has been sent</button>
          <button class="btn btn--sm btn--ghost" data-no>Not yet</button>
        </div>`);
      node.querySelector("[data-no]").addEventListener("click", close);
      node.querySelector("[data-yes]").addEventListener("click", async () => {
        close();
        try {
          await db.stampQuestionsAsked();
          toast("The clock has started on each question.");
        } catch (err) {
          toast(err.message || "That did not save.");
        }
      });
    });

    /* Everything, including what cannot be published. Confirmed, because a file
       of unpublished comments about named people is not something to produce by
       brushing a button. */
    row.querySelector('[data-act="record"]').addEventListener("click", () => {
      const { node, close } = modal(`
        <h3 style="margin-bottom:6px">Download the full record?</h3>
        <p class="hint" style="margin-bottom:12px">Every response in full, including free text
          supporters did not agree to publish and the ${held.length} question${
          held.length === 1 ? "" : "s"} held back. Device keys and account identifiers are left
          out. It is for your records, not for circulation.</p>
        <div class="btn-row">
          <button class="btn btn--sm" data-yes>Download it</button>
          <button class="btn btn--sm btn--ghost" data-no>Cancel</button>
        </div>`);
      node.querySelector("[data-no]").addEventListener("click", close);
      node.querySelector("[data-yes]").addEventListener("click", async () => {
        close();
        const text = internalExport(rows, groups.filter((g) => g.label.trim()), [...excluded]);
        const ok = await offerFile(`ktfcsa-consultation-record-${londonToday()}.txt`, text);
        if (ok) toast("Downloaded. Keep it somewhere sensible.");
      });
    });

    /* The addendum goes over in supporters' own words, and those words name
       people who never asked to be named. One box, applied to the addendum
       only: the ten questions are ours and do not name anybody. */
    const red = el(`
      <div class="field" style="margin-top:12px">
        <label for="q-redact">Names to take out of the addendum</label>
        <input id="q-redact" type="text" value="${esc(state.qRedact || "")}"
          placeholder="Separate with commas">
      </div>`);
    red.querySelector("input").addEventListener("input", (e) => {
      state.qRedact = e.target.value;
    });
    wrap2.append(red);

    const by = el(`
      <div class="field">
        <label for="q-replyby">Ask for a reply by</label>
        <input id="q-replyby" type="date" value="${esc(state.qReplyBy)}" min="${londonToday()}">
      </div>`);
    by.querySelector("input").addEventListener("change", (e) => {
      state.qReplyBy = e.target.value || state.qReplyBy;
    });
    wrap2.append(by);

    wrap2.append(row);
    wrap2.append(el(`<p class="hint">Saving marks them final. It does not publish anything: the
      results page stays closed until you press Publish, and until then the questions are visible
      only to volunteers and to anyone given early sight.
      Copying gives you the text to write your own email around; nothing is sent from here. Mark as
      sent once it has gone, which is what makes the public page count the days each question has
      gone unanswered. The addendum goes with them, so nothing a supporter asked is dropped.</p>`));
    return wrap2;
  };

  draw();
  loadSaved();
  return box;
}

/**
 * One part of the admin panel, rendered so that it cannot take the rest down.
 *
 * The panel has gone blank twice, both times because a single card threw while
 * the tab was being built and took everything with it. Nothing here is worth
 * that: a broken stats card should cost you the stats card, not the queue you
 * came in to work through.
 *
 * Covers the async half as well, since most of these cards paint from a
 * promise and a rejected one used to leave "Loading." sitting there for ever.
 */
function panelSection(wrap, title, build) {
  const broke = (err, where) => {
    console.error(`Admin section "${title || where}" failed:`, err);
    return el(`
      <div class="card panel-broke">
        <b>This part did not load</b>
        <p class="panel-broke__why">${esc(err?.message || String(err))}</p>
        <p class="hint">Everything else on this page still works. Worth reporting.</p>
      </div>`);
  };

  if (title) wrap.append(el(`<h2 class="section-title">${esc(title)}</h2>`));
  try {
    const node = build();
    if (!node) return;
    wrap.append(node);
    /* A card that paints itself later: give it somewhere to put a failure. */
    if (node.dataset && node.dataset.async === "1" && node.__settled) {
      node.__settled.catch((err) => node.replaceWith(broke(err, "async")));
    }
  } catch (err) {
    wrap.append(broke(err, "build"));
  }
}

function viewAdmin() {
  /* Last line of defence. Every part below is wrapped on its own, but the
     panel changes often and a section added later without a boundary should
     still not be able to blank the page. */
  try {
    return buildAdmin();
  } catch (err) {
    console.error("The admin panel failed to build:", err);
    const wrap = el(`<div>
      <div class="page-head"><h1>Admin</h1></div>
      <div class="card panel-broke">
        <b>The panel did not load</b>
        <p class="panel-broke__why">${esc(err?.message || String(err))}</p>
        <p class="hint">This is a fault in the site rather than anything you did.</p>
      </div>
    </div>`);
    return wrap;
  }
}

function buildAdmin() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Admin</h1>
      <p>How the site is being used, and the people using it.</p>
    </div>
  </div>`);

  if (!db.isModerator()) {
    wrap.append(el(`
      <div class="empty">
        <b>Not for you, sorry</b>
        This page is for the volunteers who run the site.
      </div>`));
    return wrap;
  }

  /* A moderator sees the panel and deals with what supporters write. Structural
     things stay hidden rather than shown and refused: a button that exists and
     then fails is worse than one that was never offered. The database refuses
     them as well, so this is the courtesy, not the control. */
  const canRunThings = db.isAdmin();

  /* Four tabs rather than one long stack of cards. The panel had grown to
     thirteen sections in a row and nothing was findable. */
  const ATABS = [["overview", "Overview"], ["consult", "Consultation"],
                 ["archive", "Archive"], ["people", "People"]];
  const atab = state.adminTab || "overview";
  /* Sticky, because the consultation tab is twenty thousand pixels tall and
     getting back to the section bar meant scrolling all the way up. */
  const abar = el(`
    <div class="segmented segmented--sticky" role="group" aria-label="Admin sections">
      ${ATABS.map(([k, l]) => `<button data-atab="${k}" class="${atab === k ? "is-active" : ""}">${
        esc(l)}<span class="seg-badge" data-badge="${k}" hidden></span></button>`).join("")}
    </div>`);
  abar.querySelectorAll("[data-atab]").forEach((b) =>
    b.addEventListener("click", () => { state.adminTab = b.dataset.atab; render({ toTop: true }); }));
  wrap.append(abar);

  /* The badge says where the work is without opening the tab to find out. */
  db.pendingActions().then((pa) => {
    if (!pa) return;
    const marks = { consult: pa.consultation || 0 };
    Object.entries(marks).forEach(([k, n]) => {
      const dot = abar.querySelector(`[data-badge="${k}"]`);
      if (dot && n > 0) { dot.textContent = n; dot.hidden = false; }
    });
  }).catch(() => {});

  /* Whatever is waiting on a volunteer, first, on every tab. Everything else
     here is information; this is the only part that is a job, so each line is
     a button that goes to where the work actually is rather than telling you a
     number and leaving you to find it. */
  const todo = el(`<div></div>`);
  db.pendingActions().then((pa) => {
    if (!pa) return;
    /* Each carries its own plural. Bolting an "s" on the end turned two pieces
       of feedback into "2 piece of feedbacks". */
    const jobs = [
      [pa.consultation, "consultation comment", "consultation comments",
        () => { state.adminTab = "consult"; render({ toTop: true }); }],
      [pa.polls, "poll suggestion", "poll suggestions", () => go("wall")],
      [pa.feedback, "piece of feedback", "pieces of feedback", () => go("feedback")],
    ].filter(([n]) => n > 0);

    if (!jobs.length) {
      todo.append(el(`<div class="todo todo--clear"><b>Nothing waiting</b>All caught up.</div>`));
      return;
    }
    const card = el(`
      <div class="todo">
        <b>${jobs.reduce((a, [n]) => a + n, 0)} waiting on you</b>
        <div class="todo__jobs"></div>
      </div>`);
    const list = $(".todo__jobs", card);
    jobs.forEach(([n, one, many, goThere]) => {
      const b = el(`<button class="todo__job">${n} ${esc(n === 1 ? one : many)} <span aria-hidden="true">›</span></button>`);
      b.addEventListener("click", goThere);
      list.append(b);
    });
    todo.append(card);
  }).catch((err) => console.warn("Could not read what is waiting:", err));
  wrap.append(todo);

  /* Grouped, because nineteen tiles in one grid is a wall of numbers and
     nobody reads the eleventh. Anything the database has not got yet is
     skipped, so an un-migrated project still gets a working panel. */
  const STAT_GROUPS = [
    ["Supporters", [
      ["supporters", "Accounts"], ["supporters_this_week", "Joined this week"],
    ]],
    ["Taking part", [
      ["predictions", "Predictions"], ["ratings", "Player ratings"],
      ["attendances", "Games marked"], ["posts", "Wall posts"], ["replies", "Replies"],
    ]],
    ["Poppies Daily", [
      ["quiz_players", "Players"], ["quiz_plays", "Days played"],
      ["quiz_today", "Played today"], ["quiz_best_streak", "Best streak"],
    ]],
    ["What fans have reported", [
      ["ground_reports", "Ground"], ["access_reports", "Access"],
      ["price_reports", "Prices"], ["pubs", "Pubs"],
    ]],
    ["Waiting on a volunteer", [
      ["feedback_waiting", "Feedback"], ["polls_waiting", "Polls"],
      ["archive_offers", "Archive offers"], ["archive_scanners", "Offered to scan"],
    ]],
  ];

  if (atab === "overview") {
    wrap.append(el(`<h2 class="section-title">Activity</h2>`));
    const statCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
    wrap.append(statCard);

    db.adminOverview().then((o) => {
      statCard.replaceChildren();
      if (!o) {
        statCard.append(el(`<p class="note" style="margin:0">Counts are not available. The newer part of the schema may not have been run yet.</p>`));
        return;
      }
      STAT_GROUPS.forEach(([heading, keys]) => {
        const have = keys.filter(([k]) => o[k] !== undefined && o[k] !== null);
        if (!have.length) return;
        statCard.append(el(`<div class="stat-group__head">${esc(heading)}</div>`));
        const grid = el(`<div class="info-grid info-grid--dense"></div>`);
        have.forEach(([key, label]) => {
          /* Green means nothing needs doing, amber means it does. Everything
             else stays neutral: colouring every tile would mean none of them
             carried any signal. */
          const v = Number(o[key]);
          let tone = "";
          if (heading === "Waiting on a volunteer") tone = v > 0 ? "warn" : "good";
          else if (/this_week|today/.test(key) && v > 0) tone = "good";
          grid.append(el(`
            <div class="info${tone ? ` info--${tone}` : ""}">
              <div class="info__label">${esc(label)}</div>
              <div class="info__value">${v.toLocaleString("en-GB")}</div>
            </div>`));
        });
        statCard.append(grid);
      });
      statCard.append(el(`<p class="note">Things people have done on the site. Page views are counted separately, below.</p>`));
    });

    panelSection(wrap, "Who is looking", () => viewsPane());
    panelSection(wrap, "Cloudflare", () => cloudflarePane());
  }

  /* The findings as they stand, for volunteers, before the public page opens on
     the Saturday. Same renderer as the public one so there is no second version
     of the maths to keep in step, with the comparison against May on top -
     which is the number this whole exercise turns on. */
  /* The queue first. Scrolling to it was the other option and it was hopeless:
     the dashboard is twenty thousand pixels tall, so "jump to the queue" meant
     a smooth scroll through the whole thing. The work belongs at the top. */
  if (atab === "consult") {
    /* Where to, within a tab that runs to several screens. Scrolls rather than
       switches, so nothing is hidden behind another click and the page can
       still be read straight through. */
    const jump = el(`
      <div class="jump" role="group" aria-label="Jump to">
        <button data-to="a-publish">Publish</button>
        <button data-to="a-questions">Questions</button>
        <button data-to="a-queue">Queue</button>
        <button data-to="a-live">Findings</button>
      </div>`);
    const goTo = (id) => {
      const target = document.getElementById(id);
      if (!target) return toast("That part has not loaded yet.");
      const top = target.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top, behavior: "smooth" });
    };
    jump.querySelectorAll("[data-to]").forEach((b) => {
      b.addEventListener("click", () => goTo(b.dataset.to));
    });
    wrap.append(jump);

    /* Where it has got to, before any of the parts. */
    panelSection(wrap, "", () => consultStatusBoard(goTo));

    /* Publishing is a button, not a clock. On a timer the findings would go out
       at midday on the Friday with whatever had been read by lunchtime. */
    const pub = el(`<div></div>`);
    db.consultationPublished().then((p) => {
      const on = Boolean(p?.results_public);
      state.resultsPublic = on;
      const card = el(`
        <div class="${on ? "todo todo--clear" : "todo"}" id="a-publish">
          <b>${on ? "The findings are public" : "The findings are not public yet"}</b>
          ${on
            ? `Published ${esc(fmtDate(String(p.published_at).slice(0, 10)))}. Supporters can see the
               report on Have Your Say.`
            : `The consultation closes at ${CLOSES_WORDS}. Until you publish, supporters see the
               turnout and a note saying the results are coming.`}
        </div>`);
      const row = el(`<div class="btn-row" style="margin-top:-8px;margin-bottom:18px"></div>`);
      /* Publishing, previewing early sight, and agreeing the questions are all
         admin work. A moderator still sees the card, so they know where things
         stand; they just have no buttons on it. */
      if (!canRunThings) {
        pub.append(card);
        pub.append(el(`<p class="hint" style="margin-top:-8px;margin-bottom:18px">Publishing is
          done by a volunteer.</p>`));
        return;
      }
      const b = el(`<button class="btn btn--sm${on ? " btn--ghost" : ""}">${
        on ? "Take the findings down" : "Publish the findings"}</button>`);
      b.addEventListener("click", () => {
        if (on) {
          db.setResultsPublic(false).then(() => { toast("Taken down."); render(); });
          return;
        }
        const { node, close } = modal(`
          <h3 style="margin-bottom:10px">Publish the findings?</h3>
          <p class="hint" style="margin-bottom:10px">They go on the public Have Your Say page
            straight away, for anybody with the link. Check the preview below this first, and
            that the questions have gone to the club.</p>
          <div class="btn-row">
            <button class="btn btn--sm" data-yes>Yes, publish</button>
            <button class="btn btn--sm btn--ghost" data-no>Not yet</button>
          </div>`);
        node.querySelector("[data-yes]").addEventListener("click", () => {
          close();
          db.setResultsPublic(true).then(() => { toast("Published."); render(); });
        });
        node.querySelector("[data-no]").addEventListener("click", close);
      });
      const prev = el(`<button class="btn btn--sm btn--ghost">Preview the report</button>`);
      prev.addEventListener("click", () => { location.hash = "#/consult/preview"; });

      /* Granting early sight lived only in the People tab, which meant leaving
         this page and searching for somebody by name. It belongs here, next to
         the thing it is about. */
      const share = el(`<button class="btn btn--sm btn--ghost">Who can see it early</button>`);
      share.addEventListener("click", () => earlySightPicker());
      row.append(b, prev, share);
      pub.append(card, row);
    }).catch(() => {});
    wrap.append(pub);

    wrap.append(el(`<h2 class="section-title" id="a-questions">Questions for the club</h2>`));
    if (canRunThings) {
      const qb = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
      wrap.append(qb);
      db.consultationQueue().then((rows) => {
        qb.replaceWith(questionWorkbench(rows));
      }).catch((err) => {
        console.error("Question workbench failed:", err);
        qb.replaceChildren();
        qb.append(el(`<p class="note" style="margin:0">${esc(err?.message
          || "Not set up in the database yet.")}</p>`));
      });
    } else {
      wrap.append(el(`<div class="card"><p class="note" style="margin:0">Agreeing the questions
        that go to the club is done by a volunteer.</p></div>`));
    }

    wrap.append(el(`<h2 class="section-title" id="a-queue">Waiting to be read</h2>`));
    wrap.append(el(`<div class="queue-slot"></div>`));
  }

  if (atab === "consult" && consultState() !== "before") {
    wrap.append(el(`<h2 class="section-title" id="a-live">Consultation, live</h2>`));
    const liveNote = el(`
      <div class="soon" style="margin-bottom:14px">
        <span class="soon__tag">${consultState() === "open" ? "Still open" : "Closed"}</span>
        <p>${consultState() === "open"
          ? `Running until ${CLOSES_WORDS}. These are the numbers so far and only you can see them. The public page opens on Saturday.`
          : "Closed. This is what the public page is showing."}</p>
      </div>`);
    wrap.append(liveNote);

    const compare = el(`<div></div>`);
    db.consultationResults().then((r) => {
      const n = r?.summary?.responses || 0;
      if (!n) return;
      const now = Number(r.summary.confidence_avg);
      /* May 2026: 189 responses, 8.1 out of 10 on the incoming consortium. The
         movement is the story, so it is worked out here rather than left for
         somebody to do in their head on a podcast. */
      const was = 8.1;
      const delta = (now - was).toFixed(1);
      compare.append(el(`
        <div class="card" style="margin-bottom:14px">
          <div class="info-grid info-grid--dense">
            <div class="info"><div class="info__label">Now</div><div class="info__value" style="color:var(--accent)">${now}<span style="font-size:0.8125rem;color:var(--text-3)">/10</span></div></div>
            <div class="info"><div class="info__label">May survey</div><div class="info__value">${was}<span style="font-size:0.8125rem;color:var(--text-3)">/10</span></div></div>
            <div class="info"><div class="info__label">Change</div><div class="info__value" style="color:${now < was ? "var(--red-400)" : "var(--ok)"}">${delta > 0 ? "+" : ""}${delta}</div></div>
          </div>
          <div class="hint">May asked about confidence in the incoming consortium and drew 189
          responses; this asks about how the club is being run now. Not the same question, so say
          so if you quote it, but it is the closest thing to a like-for-like reading we have.
          ${n} response${n === 1 ? "" : "s"} so far.</div>
        </div>`));
    }).catch(() => {});
    wrap.append(compare);

    /* Both of these read the raw responses, which only a volunteer can see, so
       they exist here and not on the public page. */
    const insights = el(`<div></div>`);
    db.consultationQueue().then((rows) => {
      if (!rows.length) return;
      const cloud = wordCloud(rows);
      if (cloud) {
        insights.append(el(`<h2 class="section-title">What supporters keep saying</h2>`));
        insights.append(cloud);
      }
      const byDay = responsesByDay(rows);
      if (byDay) {
        insights.append(el(`<h2 class="section-title">Responses by day</h2>`));
        insights.append(byDay);
      }
    }).catch((err) => {
      /* This used to swallow everything, which hid a missing import for a good
         while: the panel simply rendered without these two and said nothing. */
      console.warn("Consultation insights could not be built:", err);
    });
    wrap.append(foldable("Themes and response rate", () => insights));
    wrap.append(foldable("The full findings, as the public will see them",
      () => consultResults()));
  }

  /* Nothing a supporter wrote reaches the public or the club until it has been
     read here. Edit exists to trim an allegation out of an otherwise fair
     question rather than lose the question. */
  /* Placed above, before the dashboard. See the slot near the top of the
     consultation tab: this is the job, the numbers are reading material. */
  const consultCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);

  const paintConsult = () => {
    db.consultationQueue().then((rows) => {
      consultCard.replaceChildren();
      const items = [];
      rows.forEach((r) => {
        if (r.question) items.push({ row: r, field: "question", status: r.question_status, text: r.question, kind: "Question for the club" });
        [["positive_note", "What is going well"], ["concern_note", "Concern"]].forEach(([f, kind]) => {
          if (r[f]) items.push({ row: r, field: f, status: r.note_status, text: r[f], kind });
        });
      });
      if (!items.length) {
        consultCard.append(el(`<p class="note" style="margin:0">Nothing written in yet.</p>`));
        return;
      }

      /* A hundred and twenty items in one run is unreadable, and the three
         kinds want different heads on: a question is going to the club, a
         concern is going on a public page. Filtered by kind and by status,
         with the counts on the chips so nothing is hidden by accident. */
      const f = state.consultFilter || (state.consultFilter = { kind: "all", status: "pending" });
      const KINDS = [
        ["all", "Everything"],
        ["Question for the club", "Questions"],
        ["Concern", "Concerns"],
        ["What is going well", "Going well"],
      ];
      const STATUSES = [["pending", "Waiting"], ["approved", "Published"], ["rejected", "Rejected"], ["all", "All"]];
      const byKind = (i) => f.kind === "all" || i.kind === f.kind;
      const byStatus = (i) => f.status === "all" || i.status === f.status;
      const count = (test) => items.filter(test).length;

      const chips = el(`
        <div class="chips">
          <div class="chips__row">
            ${KINDS.map(([k, label]) => `
              <button class="chip${f.kind === k ? " is-on" : ""}" data-kind="${esc(k)}">${esc(label)}
                <span>${count((i) => (k === "all" || i.kind === k) && byStatus(i))}</span></button>`).join("")}
          </div>
          <div class="chips__row">
            ${STATUSES.map(([k, label]) => `
              <button class="chip chip--status${f.status === k ? " is-on" : ""}" data-status="${k}">${esc(label)}
                <span>${count((i) => (k === "all" || i.status === k) && byKind(i))}</span></button>`).join("")}
          </div>
        </div>`);
      chips.querySelectorAll("[data-kind]").forEach((b) =>
        b.addEventListener("click", () => { f.kind = b.dataset.kind; paintConsult(); }));
      chips.querySelectorAll("[data-status]").forEach((b) =>
        b.addEventListener("click", () => { f.status = b.dataset.status; paintConsult(); }));
      consultCard.append(chips);

      const shown = items.filter((i) => byKind(i) && byStatus(i));
      const waiting = shown.filter((i) => i.status === "pending");
      consultCard.append(el(`<p class="note" style="margin:2px 0 10px">Showing ${shown.length} of
        ${items.length}. Nothing appears publicly until you approve it.</p>`));
      if (!shown.length) {
        consultCard.append(el(`<p class="note" style="margin:0">Nothing matches that filter.</p>`));
        return;
      }

      /* Working through fifty of these one at a time is how a volunteer stops
         reading them properly, so there is a bulk path. It still goes through
         the same warning, counting how many of the selection look like they
         name somebody, because that is the whole reason for the confirm. */
      if (waiting.length > 1) {
        const bar = el(`
          <div class="bulk">
            <label class="bulk__all"><input type="checkbox" id="bulk-all"><span>Select all ${waiting.length} waiting</span></label>
            <div class="btn-row">
              <button class="btn btn--sm" id="bulk-approve" disabled>Approve selected</button>
              <button class="btn btn--sm btn--ghost" id="bulk-reject" disabled>Reject selected</button>
            </div>
          </div>`);
        consultCard.append(bar);

        const picked = () => [...consultCard.querySelectorAll("[data-pick]:checked")]
          .map((c) => waiting.find((w) => `${w.row.id}:${w.field}` === c.dataset.pick))
          .filter(Boolean);
        const sync = () => {
          const n = picked().length;
          $("#bulk-approve", bar).disabled = !n;
          $("#bulk-reject", bar).disabled = !n;
          $("#bulk-approve", bar).textContent = n ? `Approve ${n}` : "Approve selected";
          $("#bulk-reject", bar).textContent = n ? `Reject ${n}` : "Reject selected";
        };
        consultCard.addEventListener("change", (e) => {
          if (e.target.matches("[data-pick]")) sync();
        });
        $("#bulk-all", bar).addEventListener("change", (e) => {
          consultCard.querySelectorAll("[data-pick]").forEach((c) => { c.checked = e.target.checked; });
          sync();
        });

        const runBulk = async (status) => {
          const chosen = picked();
          for (const it of chosen) {
            const col = it.field === "question" ? "question_status" : "note_status";
            await db.setConsultationStatus(it.row.id, { [col]: status });
          }
          toast(`${chosen.length} ${status === "approved" ? "published" : "rejected"}.`);
          paintConsult();
          renderNav();
        };

        $("#bulk-approve", bar).addEventListener("click", () => {
          const chosen = picked();
          const named = chosen.filter((it) => looksLikeItNames(it.text).length);
          const { node, close } = modal(`
            <h3 style="margin-bottom:10px">Publish ${chosen.length} item${chosen.length === 1 ? "" : "s"}?</h3>
            <p class="hint" style="margin-bottom:10px">They go on the public results page, and any
              questions among them are sent to the club in writing.</p>
            ${named.length ? `
              <div class="warn">
                <b>${named.length === 1
                  ? "One of them looks like it names someone"
                  : `${named.length} of them look like they name someone`}</b>
                ${esc(named.map((it) => looksLikeItNames(it.text).join(", ")).join(" · "))}.
                Approving in bulk skips reading them one at a time, which is exactly when a name
                gets published by accident. Go back and do those individually if you are not sure.
              </div>` : `<p class="hint">None of them appear to name anybody.</p>`}
            <div class="btn-row" style="margin-top:14px">
              <button class="btn btn--sm" data-yes>Yes, publish ${chosen.length}</button>
              <button class="btn btn--sm btn--ghost" data-no>Cancel</button>
            </div>`);
          node.querySelector("[data-yes]").addEventListener("click", () => { close(); runBulk("approved"); });
          node.querySelector("[data-no]").addEventListener("click", close);
        });
        $("#bulk-reject", bar).addEventListener("click", () => runBulk("rejected"));
      }
      [...waiting, ...shown.filter((i) => i.status !== "pending")].forEach((it) => {
        const statusCol = it.field === "question" ? "question_status" : "note_status";
        const card = el(`
          <div class="suggestion${it.status === "pending" ? "" : " is-done"}">
            <div class="suggestion__meta">
              ${it.status === "pending"
                ? `<label class="pick"><input type="checkbox" data-pick="${esc(it.row.id)}:${esc(it.field)}"><span class="sr-only">Select this one</span></label>`
                : ""}
              <span class="pill">${esc(it.kind)}</span>
              ${it.row.publish_ok ? `<span class="pill pill--gold">May publish${it.row.attribution ? `, as ${esc(it.row.attribution)}` : ""}</span>` : `<span class="pill pill--muted">Not for publication</span>`}
              ${it.status !== "pending" ? `<span class="pill pill--muted">${esc(it.status)}</span>` : ""}
            </div>
            <p class="suggestion__text">${esc(it.text)}</p>
          </div>`);
        if (it.status === "pending") {
          const row = el(`<div class="btn-row" style="margin-top:8px"></div>`);
          const act = (label, patch, cls = "btn--sm btn--ghost") => {
            const b = el(`<button class="btn ${cls}">${label}</button>`);
            b.addEventListener("click", async () => {
              await db.setConsultationStatus(it.row.id, patch);
              toast("Saved.");
              paintConsult();
              renderNav();
            });
            return b;
          };
          const approve = el(`<button class="btn btn--sm">Approve</button>`);
          approve.addEventListener("click", () => confirmPublish({
            text: it.text, kind: it.kind, attribution: it.row.publish_ok ? it.row.attribution : null,
            onYes: async () => {
              await db.setConsultationStatus(it.row.id, { [statusCol]: "approved" });
              toast("Published.");
              paintConsult();
              renderNav();
            },
          }));
          row.append(approve);
          const edit = el(`<button class="btn btn--sm btn--ghost">Edit</button>`);
          edit.addEventListener("click", () => {
            const { node: en, close: eclose } = modal(`
              <h3 style="margin-bottom:10px">Edit before publishing</h3>
              <p class="hint" style="margin-bottom:10px">Trim anything you would not stand behind.
                What is left is what goes out.</p>
              <textarea rows="5" style="width:100%">${esc(it.text)}</textarea>
              <button class="btn btn--full" style="margin-top:10px" data-save>Save and publish</button>`);
            const ta = en.querySelector("textarea");
            en.querySelector("[data-save]").addEventListener("click", () => {
              const edited = ta.value.trim();
              eclose();
              confirmPublish({
                text: edited, kind: it.kind,
                attribution: it.row.publish_ok ? it.row.attribution : null,
                onYes: async () => {
                  await db.setConsultationStatus(it.row.id, { [it.field]: edited, [statusCol]: "approved" });
                  toast("Saved and published.");
                  paintConsult();
                  renderNav();
                },
              });
            });
          });
          row.append(edit);
          row.append(act("Reject", { [statusCol]: "rejected" }));
          card.append(row);
        } else {
          /* Anything already dealt with can be pulled back. Approving is the
             one action here that cannot be undone by waiting, so it needs to
             be undoable by clicking. */
          const row = el(`<div class="btn-row" style="margin-top:8px"></div>`);
          const back = el(`<button class="btn btn--sm btn--ghost">${
            it.status === "approved" ? "Unpublish" : "Put back in the queue"}</button>`);
          back.addEventListener("click", async () => {
            await db.setConsultationStatus(it.row.id, { [statusCol]: "pending" });
            toast(it.status === "approved"
              ? "Unpublished. It is out of the public results."
              : "Back in the queue.");
            paintConsult();
            renderNav();
          });
          row.append(back);
          card.append(row);
        }
        consultCard.append(card);
      });
    }).catch(() => {
      consultCard.replaceChildren();
      consultCard.append(el(`<p class="note" style="margin:0">The consultation is not set up in the
        database yet.</p>`));
    });
  };
  if (atab === "consult") $(".queue-slot", wrap).append(consultCard);
  paintConsult();

  /* The offers were readable by volunteers in policy and shown nowhere, which
     is the same as not collecting them. Names are here because somebody has to
     ring these people; the public page shows counts and nothing else. */
  const offersCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
  if (atab === "archive") {
    panelSection(wrap, "Archive project offers", () => offersCard);
  }

  /* Same shape as the People tab: what the list adds up to, then a way to
     narrow it, then the list. Before, it was every offer in one run with the
     capabilities buried in a subtitle, so "who can actually scan" meant
     reading all of them. */
  const paintOffers = () => {
    db.archiveOfferList().then((rows) => {
      offersCard.replaceChildren();
      if (!rows.length) {
        offersCard.append(el(`<p class="note" style="margin:0">Nobody has offered yet. The page is at
          <b>More, Supporters, Archive Project</b>.</p>`));
        return;
      }

      const WHAT = [["can_scan", "Scanning"], ["has_media", "Has material"],
                    ["can_catalogue", "Cataloguing"], ["can_store", "Kit or storage"]];

      offersCard.append(el(`
        <div class="info-grid info-grid--dense">
          <div class="info"><div class="info__label">Offers</div>
            <div class="info__value">${rows.length}</div></div>
          ${WHAT.map(([k, label]) => {
            const n = rows.filter((r) => r[k]).length;
            return `<div class="info${k === "can_scan" && n ? " info--good" : ""}">
              <div class="info__label">${esc(label)}</div>
              <div class="info__value">${n}</div></div>`;
          }).join("")}
        </div>`));

      let filter = state.offerFilter || "all";
      const FILTERS = [["all", "All", () => true],
        ...WHAT.map(([k, label]) => [k, label, (r) => Boolean(r[k])]),
        ["notes", "Left a note", (r) => Boolean(r.note)]];

      const chips = el(`<div class="chips__row" style="margin:12px 0 10px"></div>`);
      FILTERS.forEach(([key, label, test]) => {
        const n = rows.filter(test).length;
        const b = el(`<button class="chip${filter === key ? " is-on" : ""}">${esc(label)} <span>${n}</span></button>`);
        b.addEventListener("click", () => { state.offerFilter = key; paintOffers(); });
        chips.append(b);
      });
      offersCard.append(chips);

      const test = FILTERS.find(([k]) => k === filter)?.[2] || (() => true);
      const shown = rows.filter(test);
      if (!shown.length) {
        offersCard.append(el(`<p class="note">Nobody in that group.</p>`));
      }

      shown.forEach((r) => {
        const offers = WHAT.filter(([k]) => r[k]).map(([, l]) => l);
        const row = el(`
          <div class="offer-row">
            <div class="offer-row__head">
              <span class="person__name">${namePlusTag(r.profile_id, r.display_name, { link: false })}</span>
              <span class="person__meta">${esc(fmtDate(String(r.created_at).slice(0, 10), "short"))}</span>
            </div>
            <div class="person__badges" style="justify-content:flex-start;max-width:none">${
              offers.map((o) => `<span class="pill${o === "Scanning" ? " pill--gold" : ""}">${esc(o)}</span>`).join("")
              || `<span class="pill">Nothing ticked</span>`}</div>
            ${r.note ? `<p class="offer-row__note">${esc(r.note)}</p>` : ""}
          </div>`);
        offersCard.append(row);
      });

      /* The point of the list is getting hold of these people, and that
         happens away from a phone screen. */
      const copy = el(`<button class="btn btn--sm btn--ghost" style="margin-top:12px">Copy this list</button>`);
      copy.addEventListener("click", async () => {
        const text = shown.map((r) => {
          const offers = WHAT.filter(([k]) => r[k]).map(([, l]) => l).join(", ") || "nothing ticked";
          return `${r.display_name} - ${offers}${r.note ? ` - "${String(r.note).replace(/\s+/g, " ")}"` : ""}`;
        }).join("\n");
        const ok = await copyText(text);
        if (ok) return toast(`${shown.length} copied.`);
        modal(`<h3 style="margin-bottom:10px">Archive offers</h3>
          <textarea readonly rows="12" style="width:100%">${esc(text)}</textarea>`);
      });
      offersCard.append(copy);

      offersCard.append(el(`<p class="note">Offers are private. Only volunteers see this list, and
        the public page shows totals with no names.</p>`));
    }).catch(() => {
      offersCard.replaceChildren();
      offersCard.append(el(`<p class="note" style="margin:0">Offers are not switched on in the
        database yet.</p>`));
    });
  };
  paintOffers();

  const peopleCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
  /* Managing the tags themselves, rather than who wears them. Admin only: a
     moderator handing out labels is fine, inventing new ones is not. */
  const tagsCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
  const paintTags = () => {
    db.supporterTags().then((rows) => {
      tagsCard.replaceChildren();
      if (rows === null) {
        tagsCard.append(el(`<p class="note" style="margin:0">Tags are not in the database yet.
          The site is using its built-in list.</p>`));
        return;
      }

      rows.forEach((t) => {
        const row = el(`
          <div class="tag-row">
            <span class="pill">${esc(t.label)}</span>
            <span class="tag-row__key">${esc(t.key)}</span>
            <span class="tag-row__acts"></span>
          </div>`);
        const acts = row.querySelector(".tag-row__acts");

        const ren = el(`<button class="link-btn">Rename</button>`);
        ren.addEventListener("click", () => {
          const { node, close } = modal(`
            <h3 style="margin-bottom:10px">Rename ${esc(t.label)}</h3>
            <div class="field"><label for="tg-l">What it says</label>
              <input id="tg-l" type="text" value="${esc(t.label)}" maxlength="40"></div>
            <p class="hint">The key stays <b>${esc(t.key)}</b>, so nobody loses their tag.</p>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn--sm" data-ok>Save</button>
              <button class="btn btn--sm btn--ghost" data-no>Cancel</button>
            </div>`);
          node.querySelector("[data-no]").addEventListener("click", close);
          node.querySelector("[data-ok]").addEventListener("click", async () => {
            const label = node.querySelector("#tg-l").value.trim();
            if (label.length < 2) return toast("Give it a name.", "bad");
            try {
              await db.upsertTag(t.key, label, t.sort);
              close(); toast("Renamed.", "good"); await loadTags(); paintTags(); paintPeople();
            } catch (err) { toast(err.message || "That did not save.", "bad"); }
          });
        });
        acts.append(ren);

        const del = el(`<button class="link-btn">Delete</button>`);
        del.addEventListener("click", async () => {
          try {
            await db.deleteTag(t.key);
            toast("Deleted.", "good"); await loadTags(); paintTags(); paintPeople();
          } catch (err) {
            /* The function refuses while anybody is wearing it and says how
               many, which is the useful half of the message. */
            toast(err.message || "That did not work.", "bad");
          }
        });
        acts.append(del);
        tagsCard.append(row);
      });

      const add = el(`<button class="btn btn--sm btn--ghost" style="margin-top:12px">Add a tag</button>`);
      add.addEventListener("click", () => {
        const { node, close } = modal(`
          <h3 style="margin-bottom:10px">Add a tag</h3>
          <div class="field"><label for="tg-new">What it says</label>
            <input id="tg-new" type="text" placeholder="Matchday Steward" maxlength="40"></div>
          <p class="hint">The key is made from the name: lower case, dashes for spaces. It cannot
            be changed later, though the wording can.</p>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn btn--sm" data-ok>Add it</button>
            <button class="btn btn--sm btn--ghost" data-no>Cancel</button>
          </div>`);
        node.querySelector("[data-no]").addEventListener("click", close);
        node.querySelector("[data-ok]").addEventListener("click", async () => {
          const label = node.querySelector("#tg-new").value.trim();
          const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          if (label.length < 2 || key.length < 2) return toast("Give it a name.", "bad");
          try {
            await db.upsertTag(key, label, (rows.length + 1) * 10);
            close(); toast(`${label} added.`, "good");
            await loadTags(); paintTags(); paintPeople();
          } catch (err) { toast(err.message || "That did not save.", "bad"); }
        });
      });
      tagsCard.append(add);
      tagsCard.append(el(`<p class="hint">A tag in use cannot be deleted. Take it off everybody
        wearing it first, and the delete will go through.</p>`));
    }).catch(() => {
      tagsCard.replaceChildren();
      tagsCard.append(el(`<p class="note" style="margin:0">Could not read the tags.</p>`));
    });
  };

  /* Sixty rows each carrying eight tag buttons was a wall nobody could read.
     The list scans first: name, what they are, when they joined. The controls
     are one tap away, on the person you actually meant. */
  const paintPeople = () => {
    db.adminPeople().then((rows) => {
      peopleCard.replaceChildren();
      if (!rows.length) {
        peopleCard.append(el(`<p class="note" style="margin:0">Nobody yet.</p>`));
        return;
      }

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const counts = {
        all: rows.length,
        admins: rows.filter((r) => r.is_admin).length,
        tagged: rows.filter((r) => r.tag).length,
        mods: rows.filter((r) => r.is_moderator && !r.is_admin).length,
        early: rows.filter((r) => db.isResultsViewer(r.id)).length,
        fresh: rows.filter((r) => String(r.created_at) >= weekAgo).length,
        email: rows.filter((r) => r.email_opt_in).length,
      };

      peopleCard.append(el(`
        <div class="info-grid info-grid--dense">
          <div class="info"><div class="info__label">Accounts</div>
            <div class="info__value">${counts.all}</div></div>
          <div class="info${counts.fresh ? " info--good" : ""}"><div class="info__label">This week</div>
            <div class="info__value">${counts.fresh}</div></div>
          <div class="info"><div class="info__label">Volunteers</div>
            <div class="info__value">${counts.admins}</div></div>
          <div class="info"><div class="info__label">Moderators</div>
            <div class="info__value">${counts.mods}</div></div>
          <div class="info"><div class="info__label">Tagged</div>
            <div class="info__value">${counts.tagged}</div></div>
          <div class="info"><div class="info__label">Early sight</div>
            <div class="info__value">${counts.early}</div></div>
          <div class="info"><div class="info__label">Email opted in</div>
            <div class="info__value">${counts.email}</div></div>
        </div>`));

      const FILTERS = [
        ["all", "Everyone", () => true],
        ["fresh", "Joined this week", (r) => String(r.created_at) >= weekAgo],
        ["admins", "Volunteers", (r) => r.is_admin],
        ["mods", "Moderators", (r) => r.is_moderator && !r.is_admin],
        ["tagged", "Tagged", (r) => Boolean(r.tag)],
        ["untagged", "Untagged", (r) => !r.tag && !r.is_admin],
        ["early", "Early sight", (r) => db.isResultsViewer(r.id)],
        ["email", "Email opted in", (r) => r.email_opt_in],
      ];
      let filter = state.peopleFilter || "all";
      let sort = state.peopleSort || "new";

      const chips = el(`<div class="chips__row" style="margin:12px 0 10px"></div>`);
      FILTERS.forEach(([key, label, test]) => {
        const n = rows.filter(test).length;
        const b = el(`<button class="chip${filter === key ? " is-on" : ""}">${esc(label)} <span>${n}</span></button>`);
        b.addEventListener("click", () => { filter = state.peopleFilter = key; paintPeople(); });
        chips.append(b);
      });
      peopleCard.append(chips);

      const tools = el(`
        <div class="people-tools">
          <input class="admin-search" type="search" placeholder="Search by name" aria-label="Search supporters">
          <button class="chip">${sort === "new" ? "Newest first" : "A to Z"}</button>
        </div>`);
      const search = tools.querySelector("input");
      tools.querySelector(".chip").addEventListener("click", () => {
        sort = state.peopleSort = sort === "new" ? "az" : "new";
        paintPeople();
      });
      peopleCard.append(tools);

      const list = el(`<div></div>`);
      peopleCard.append(list);

      const draw = (q = "") => {
        const want = q.trim().toLowerCase();
        const test = FILTERS.find(([k]) => k === filter)?.[2] || (() => true);
        let shown = rows.filter(test)
          .filter((r) => !want || (r.display_name || "").toLowerCase().includes(want));
        shown = sort === "az"
          ? shown.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""))
          : shown.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

        list.replaceChildren();
        if (!shown.length) {
          list.append(el(`<p class="note">Nobody matches that.</p>`));
          return;
        }

        shown.slice(0, 60).forEach((r) => {
          const seeing = db.isResultsViewer(r.id);
          const badges = [
            r.is_admin ? `<span class="pill pill--gold">Volunteer</span>` : "",
            r.is_moderator && !r.is_admin ? `<span class="pill pill--gold">Moderator</span>` : "",
            r.tag ? `<span class="pill">${esc(TAG_LABEL[r.tag] || r.tag)}</span>` : "",
            seeing ? `<span class="pill">Early sight</span>` : "",
            r.email_opt_in ? `<span class="pill">Email</span>` : "",
          ].filter(Boolean).join("");

          const row = el(`
            <div class="person">
              <button class="person__row" type="button" aria-expanded="false">
                <span class="person__who">
                  <span class="person__name">${namePlusTag(r.id, r.display_name, { link: false })}</span>
                  <span class="person__meta">Joined ${esc(fmtDate(String(r.created_at).slice(0, 10), "short"))}</span>
                </span>
                <span class="person__badges">${badges}</span>
                <span class="person__chev" aria-hidden="true">\u203A</span>
              </button>
              <div class="person__panel" hidden></div>
            </div>`);

          const panel = row.querySelector(".person__panel");
          const toggle = row.querySelector(".person__row");
          let built = false;
          toggle.addEventListener("click", () => {
            const open = !panel.hidden;
            panel.hidden = open;
            toggle.setAttribute("aria-expanded", String(!open));
            row.classList.toggle("person--open", !open);
            if (built || open) return;
            built = true;

            /* Only an admin hands out roles. A moderator sees the person and
               their tag and nothing that would let them promote anybody,
               themselves included. The function refuses it as well. */
            if (canRunThings && !r.is_admin) {
              const isMod = Boolean(r.is_moderator);
              panel.append(el(`<div class="person__field">Role</div>`));
              const mod = el(`<button class="tag-btn${isMod ? " is-on" : ""}" type="button">${
                isMod ? "\u2713 Moderator" : "Make a moderator"}</button>`);
              mod.addEventListener("click", async () => {
                mod.disabled = true;
                try {
                  await db.setModerator(r.id, !isMod);
                  toast(isMod ? `${r.display_name} is no longer a moderator.`
                              : `${r.display_name} can now moderate.`, "good");
                  paintPeople();
                } catch (err) {
                  mod.disabled = false;
                  toast(err.message || "That did not save.", "bad");
                }
              });
              panel.append(mod);
              panel.append(el(`<p class="hint">A moderator can read the panel, approve or reject
                what supporters write, and hide a post. They cannot publish the findings, agree
                the questions, or hand out roles.</p>`));
            }

            if (canRunThings && !r.is_admin) {
              const eye = el(`<button class="tag-btn${seeing ? " is-on" : ""}" type="button">${
                seeing ? "\u2713 Sees results early" : "Give early sight of results"}</button>`);
              eye.addEventListener("click", async () => {
                eye.disabled = true;
                try {
                  await db.setResultsViewer(r.id, !seeing);
                  toast(seeing ? `${r.display_name} can no longer see them early.`
                               : `${r.display_name} can see the results early.`, "good");
                  paintPeople();
                } catch (err) {
                  eye.disabled = false;
                  toast(err.message || "That did not save.", "bad");
                }
              });
              panel.append(el(`<div class="person__field">Early sight of consultation results</div>`));
              panel.append(eye);
            }

            /* Work done away from the app. Darren Young wrote the pen pics
               for all nineteen players and no form on this site could ever
               have counted it. The reason is shown to the supporter on their
               own card, so it is written to be read by them, not by us. */
            if (canRunThings) {
              panel.append(el(`<div class="person__field">Points for work off the app</div>`));
              const give = el(`
                <div class="row row--wrap credit-row">
                  <input class="input credit-why" maxlength="120" placeholder="What for, in their words">
                  <input class="input credit-n" type="number" min="-500" max="500" step="5"
                    value="40" style="max-width:90px" aria-label="Points">
                  <button class="btn btn--sm" type="button">Award</button>
                </div>`);
              const why = give.querySelector(".credit-why");
              const num = give.querySelector(".credit-n");
              give.querySelector("button").addEventListener("click", async (e) => {
                const btn = e.currentTarget;
                const reason = why.value.trim();
                const pts = Number(num.value);
                if (reason.length < 3) { toast("Say what it is for.", "bad"); return; }
                if (!Number.isFinite(pts) || !pts) { toast("How many points?", "bad"); return; }
                btn.disabled = true;
                try {
                  await db.awardPoints(r.id, reason, pts);
                  toast(`${r.display_name} credited ${pts > 0 ? "+" : ""}${pts}.`, "good");
                  why.value = "";
                  paintPeople();
                } catch (err) {
                  btn.disabled = false;
                  toast(err.message || "That did not save.", "bad");
                }
              });
              panel.append(give);

              const held = el(`<div class="credit-list"></div>`);
              panel.append(held);
              db.pointsCredits(r.id).then((rows) => {
                if (!rows.length) return;
                rows.forEach((c) => {
                  const line = el(`
                    <div class="pts-row">
                      <span>${esc(c.reason)}</span>
                      <span class="pts-row__n">${c.points > 0 ? "+" : ""}${c.points}</span>
                      <button class="link-btn" type="button">Withdraw</button>
                    </div>`);
                  line.querySelector("button").addEventListener("click", async () => {
                    try {
                      await db.withdrawPoints(c.id);
                      toast("Withdrawn.", "good");
                      paintPeople();
                    } catch (err) { toast(err.message || "That did not save.", "bad"); }
                  });
                  held.append(line);
                });
              }).catch(() => {});
            }

            /* A spare account somebody signed up with twice. Hidden rather
               than deleted: the sign-in still belongs to them, and hiding
               undoes. It drops off every board and out of the people list. */
            if (canRunThings && !r.is_admin) {
              const off = Boolean(r.dormant);
              panel.append(el(`<div class="person__field">Duplicate or abandoned account</div>`));
              const d = el(`<button class="tag-btn${off ? " is-on" : ""}" type="button">${
                off ? "\u2713 Hidden as dormant" : "Hide as dormant"}</button>`);
              d.addEventListener("click", async () => {
                d.disabled = true;
                try {
                  await db.setDormant(r.id, !off);
                  r.dormant = !off;
                  toast(off ? `${r.display_name} is listed again.`
                            : `${r.display_name} is hidden from the boards.`, "good");
                  paintPeople();
                } catch (err) {
                  d.disabled = false;
                  toast(err.message || "That did not save.", "bad");
                }
              });
              panel.append(d);
              panel.append(el(`<p class="hint">They keep their sign-in and lose nothing. This only
                takes them off the boards and out of this list.</p>`));
            }

            panel.append(el(`<div class="person__field">Tag</div>`));
            const picker = el(`<div class="person__tags"${canRunThings ? "" : " aria-disabled=\"true\""}></div>`);
            [["", "None"], ...TAG_ORDER.map((k) => [k, TAG_LABEL[k]])].forEach(([key, label]) => {
              const on = (r.tag || "") === key;
              const b = el(`<button class="tag-btn${on ? " is-on" : ""}" type="button"${
                canRunThings ? "" : " disabled"}>${esc(label)}</button>`);
              b.addEventListener("click", async () => {
                if (on || !canRunThings) return;
                b.disabled = true;
                try {
                  await db.setTag(r.id, key || null);
                  r.tag = key || null;
                  toast(key ? `${r.display_name} is now ${TAG_LABEL[key]}.`
                            : `Tag removed from ${r.display_name}.`, "good");
                  paintPeople();
                } catch (err) {
                  toast(err.message || "That did not save.", "bad");
                  b.disabled = false;
                }
              });
              picker.append(b);
            });
            panel.append(picker);

            /* Deliberately not here: making somebody an admin, and deleting an
               account. Both are done in Supabase, on purpose. A mis-tap in a
               list of sixty should not be able to hand over the keys. */
            panel.append(el(`<p class="hint" style="margin-bottom:0">Admin rights and deleting an
              account are done in Supabase, not here.</p>`));
          });

          list.append(row);
        });

        if (shown.length > 60) {
          list.append(el(`<p class="note">Showing 60 of ${shown.length}. Search or filter to narrow it down.</p>`));
        }
      };

      search.addEventListener("input", () => draw(search.value));
      draw();
    });
  };

  /* Appended here rather than beside peopleCard, because tagsCard and
     paintTags are consts declared below it and reaching for either of them
     earlier throws before initialisation, which took the whole tab out. */
  if (atab === "people") {
    panelSection(wrap, "People", () => { paintPeople(); return peopleCard; });
    if (canRunThings) {
      panelSection(wrap, "Tags", () => { paintTags(); return tagsCard; });
    }
  }

  return wrap;
}

/* =========================================================== supporter tags */

/* The ten that were hard coded, kept as the fallback rather than the source.
   The real list lives in the database so a volunteer can add to it; this is
   what the site shows if that table is not there yet, or if the fetch fails,
   so a tag never renders as a bare slug. */
const TAG_FALLBACK = {
  contributor: "Contributor",
  "top-contributor": "Top Contributor",
  "ktfcsa-volunteer": "KTFCSA Volunteer",
  "club-volunteer": "Club Volunteer",
  reporter: "Reporter",
  photographer: "Photographer",
  commentator: "Commentator",
  historian: "Historian",
  groundhopper: "Groundhopper",
  legend: "Legend",
};

/* Filled from supporter_tags on boot. A Proxy would be neater than reassigning
   a const, but this is read in six places and a plain object keeps them all
   working unchanged. */
let TAG_LABEL = { ...TAG_FALLBACK };
let TAG_ORDER = Object.keys(TAG_FALLBACK);

async function loadTags() {
  const rows = await db.supporterTags().catch(() => null);
  if (!rows || !rows.length) return;   /* keep the fallback */
  TAG_LABEL = Object.fromEntries(rows.map((r) => [r.key, r.label]));
  TAG_ORDER = rows.map((r) => r.key);
}

const TAG_WHY = {
  contributor: "Has added information other supporters rely on",
  "top-contributor": "Has put a great deal into this site",
  "ktfcsa-volunteer": "Helps run the Supporters\u2019 Association",
  "club-volunteer": "Gives their time to Kettering Town itself",
  reporter: "Writes for the site",
  photographer: "Takes the photographs",
  commentator: "Calls the games",
  historian: "Knows the club's past better than anyone",
  groundhopper: "Does the away days, all of them",
  legend: "One of the good ones",
  /* Explains an odd-looking post rather than leaving other supporters to
     wonder why somebody is talking about buttons. */
  tester: "Tries the app before everyone else, and tells us what is broken",
};

/* A couple of these are meant to stand out from the rest. */
const TAG_SPECIAL = new Set(["top-contributor", "legend"]);

/**
 * The tag next to a name. A volunteer can hand one out, which beats anything
 * worked out from the rows: Darren Young wrote every pen pic on the site and
 * had never filed a ground report, so nothing would have marked him.
 */
/**
 * A name with its tag beside it, for the places that only had a name: the
 * leaderboards, the admin lists, the archive offers. A tag that only shows up
 * on the fan wall is not much of a tag.
 */
/**
 * A supporter's name wherever it appears in a table, with whatever they have
 * earned next to it.
 *
 * The name opens their card. This one function feeds the prediction league,
 * the attendance table, the quiz ladder and the rest, so making it tappable
 * here made every table tappable at once.
 *
 * `link: false` for the admin People list, where the name already sits inside
 * the button that expands the row: a button inside a button is invalid, and
 * the two would fight over the click.
 */
function namePlusTag(profileId, name, { link = true } = {}) {
  const shown = esc(name || "A supporter");
  const vol = profileId && db.isVolunteer(profileId)
    ? `<span class="pill pill--vol" title="Runs this site">Admin</span>` : "";
  const who = link && profileId
    ? `<span class="named__link" data-supporter="${esc(String(profileId))}"
         role="link" tabindex="0">${shown}</span>`
    : shown;
  return `<span class="named">${who}${vol}${supporterTag(profileId)}</span>`;
}

function supporterTag(profileId) {
  if (!profileId || db.isVolunteer(profileId)) return "";
  const given = db.tagOf(profileId);
  if (given) {
    const cls = TAG_SPECIAL.has(given) ? "pill pill--contrib pill--special" : "pill pill--contrib";
    return `<span class="${cls}" title="${esc(TAG_WHY[given] || "")}">${esc(TAG_LABEL[given] || given)}</span>`;
  }
  if (db.isContributor(profileId)) {
    return `<span class="pill pill--contrib" title="Has added ground or access information for other supporters">Contributor</span>`;
  }
  return "";
}

/** Last five results, oldest first, as a row of letters a supporter can read. */
function formRun(run) {
  if (!run) return "";
  return `<span class="form">${[...run].map((r) =>
    `<span class="form__r form__r--${r.toLowerCase()}" title="${
      r === "W" ? "Won" : r === "L" ? "Lost" : "Drew"
    }">${r}</span>`).join("")}</span>`;
}

/** A club's form from the league table, since that is where the sync puts it. */
const formFor = (name) => {
  const row = (state.league?.table || []).find((r) => plainClub(r.name) === plainClub(name));
  return row?.form || "";
};

const plainClub = (s) => String(s || "").toLowerCase()
  .replace(/\b(f\.?c\.?|football club|afc)\b/g, "").replace(/[^a-z0-9]/g, "");

/* ================================================================== videos */

/* The club streams commentary on a match and puts up highlights and interviews
   afterwards. All of it comes from the channel's public feed, tied to a fixture
   where the title allows. Nothing here needs an API key. */

const VIDEO_KIND = {
  commentary: "Commentary",
  highlights: "Highlights",
  interview: "Interview",
  other: "From the club",
};

const videosFor = (fixtureId) => state.videos.filter((v) => v.fixtureId === fixtureId);

/* A stream nobody named comes through as "My Broadcast", which tells a
   supporter nothing. Where we know the game it belongs to, say that instead. */
const UNTITLED_VIDEO = /^(my broadcast|live stream|untitled|broadcast|live)\b/i;

function videoTitle(v) {
  const raw = String(v.title || "").trim();
  if (!UNTITLED_VIDEO.test(raw)) return raw;
  const f = fixtures().find((x) => x.id === v.fixtureId);
  return f ? `Commentary: ${clubName(f.opponent)}` : "Match commentary";
}

const videoUrl = (v) => `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
const videoThumb = (v) => `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/mqdefault.jpg`;

/* Commentary is worth pointing at while a game is on. The feed does not say
   whether a stream is live, so this is a window around kick-off rather than a
   fact, and it is worded that way. */
const LIVE_FROM_MS = 30 * 60 * 1000;
const LIVE_UNTIL_MS = 150 * 60 * 1000;

function liveCommentary() {
  const now = Date.now();
  for (const f of fixtures()) {
    const ko = kickoffTime(f);
    if (!ko) continue;
    const t = ko.getTime();
    if (now < t - LIVE_FROM_MS || now > t + LIVE_UNTIL_MS) continue;
    const v = videosFor(f.id).find((x) => x.kind === "commentary");
    if (v) return { fixture: f, video: v };
  }
  return null;
}

/** The banner shown on Fixtures and the Fan Wall while a game is on. */
function liveBanner() {
  const live = liveCommentary();
  if (!live) return null;
  const node = el(`
    <a class="live-strip" href="${esc(videoUrl(live.video))}" target="_blank" rel="noopener">
      <span class="live-strip__dot" aria-hidden="true"></span>
      <span class="live-strip__text">
        <b>Commentary should be live now</b>
        <span>${esc(clubName(live.fixture.opponent))}, on the club's YouTube channel.</span>
      </span>
      <span class="live-strip__go" aria-hidden="true">Watch</span>
    </a>`);
  return node;
}

/** An embedded player, used on the match page. */
function videoEmbed(v) {
  return el(`
    <div class="embed">
      <iframe src="https://www.youtube-nocookie.com/embed/${esc(v.videoId)}"
        title="${esc(videoTitle(v))}" loading="lazy" allowfullscreen
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>`);
}

/** A row in a list of videos: thumbnail, title, what sort it is. */
function videoRow(v) {
  return el(`
    <a class="vid" href="${esc(videoUrl(v))}" target="_blank" rel="noopener">
      <img class="vid__thumb" src="${esc(videoThumb(v))}" alt="" loading="lazy" width="160" height="90">
      <span class="vid__text">
        <span class="vid__kind">${esc(VIDEO_KIND[v.kind] || VIDEO_KIND.other)}</span>
        <span class="vid__title">${esc(videoTitle(v))}</span>
        <span class="vid__when">${esc(fmtDate(v.published.slice(0, 10), "short"))}${
          /* Whose upload it is, when it is not the club's own. The home side
             films the highlights more often than we do, and they deserve the
             credit on their own work. */
          v.channel ? ` · ${esc(v.channel)}` : ""}</span>
      </span>
    </a>`);
}

function viewVideos() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Club videos</h1>
      <p>Commentary, highlights and interviews from the Kettering Town FC channel,
         gathered here and tied to the game they belong to.</p>
    </div>
  </div>`);

  /* Above the videos, not buried under them. These are the club's, made by the
     club, and the page should say so before it shows a single one of them. */
  if (state.videoChannel) {
    const credit = el(`
      <a class="card yt-credit" href="${esc(state.videoChannel)}" target="_blank" rel="noopener">
        <span class="yt-credit__mark" aria-hidden="true">${ICON.play}</span>
        <span class="yt-credit__body">
          <b>Kettering Town FC on YouTube</b>
          <span>Every video here is the club's own, made and posted by them. This page gathers
            them and ties them to the game they belong to. Subscribe to the channel for
            everything as it goes up.</span>
        </span>
        <span class="yt-credit__go" aria-hidden="true">\u2197</span>
      </a>`);
    wrap.append(credit);
  }

  if (!state.videos.length) {
    wrap.append(el(`
      <div class="empty">
        <b>Nothing to show yet</b>
        The club's videos will appear here as they are posted.
      </div>`));
    return wrap;
  }

  const live = liveBanner();
  if (live) wrap.append(live);

  /* Grouped by fixture where we know it, so commentary, highlights and the
     interviews from one game sit together. */
  const byFixture = new Map();
  const loose = [];
  state.videos.forEach((v) => {
    if (!v.fixtureId) return loose.push(v);
    if (!byFixture.has(v.fixtureId)) byFixture.set(v.fixtureId, []);
    byFixture.get(v.fixtureId).push(v);
  });

  const all = fixtures();
  [...byFixture.entries()]
    .map(([id, vids]) => ({ fixture: all.find((f) => f.id === id), vids }))
    .filter((g) => g.fixture)
    .sort((a, b) => b.fixture.date.localeCompare(a.fixture.date))
    .forEach(({ fixture, vids }) => {
      wrap.append(el(`<h2 class="section-title">${esc(clubName(fixture.opponent))}, ${esc(fmtDate(fixture.date, "short"))}</h2>`));
      const card = el(`<div class="card vid-list"></div>`);
      vids.forEach((v) => card.append(videoRow(v)));
      wrap.append(card);
    });

  if (loose.length) {
    wrap.append(el(`<h2 class="section-title">Everything else</h2>`));
    const card = el(`<div class="card vid-list"></div>`);
    loose.forEach((v) => card.append(videoRow(v)));
    wrap.append(card);
  }

  wrap.append(el(`<p class="note">Straight from
    ${state.videoChannel
      ? `<a href="${esc(state.videoChannel)}" target="_blank" rel="noopener">the club's YouTube
         channel</a>`
      : "the club's YouTube channel"}, and theirs rather than ours. Videos are matched to a game
    by their title, so the odd one may sit under Everything else.</p>`));
  return wrap;
}

/* =========================================================== player profile */

/* One player, gathered from data already loaded: appearances from team sheets,
   goals and cards from the feed, and the marks other supporters gave them.
   No new tables behind any of it. */

function playerRecord(name) {
  const key = String(name || "").toLowerCase();
  const games = [];
  fixtures().forEach((f) => {
    if (f.status !== "played") return;
    const sheet = (f.lineup || []).find((pl) => pl.name.toLowerCase() === key);
    const goals = (f.events?.goals || []).filter((g) => g.ours && g.name.toLowerCase() === key);
    const cards = (f.events?.cards || []).filter((c) => c.ours && c.name.toLowerCase() === key);
    if (!sheet && !goals.length && !cards.length) return;
    games.push({ fixture: f, sheet, goals, cards, rating: db.matchRating(f.id, name) });
  });
  return {
    games,
    starts: games.filter((g) => g.sheet?.started).length,
    goals: games.reduce((n, g) => n + g.goals.length, 0),
    yellows: games.reduce((n, g) => n + g.cards.filter((c) => !c.dismissed).length, 0),
    reds: games.reduce((n, g) => n + g.cards.filter((c) => c.dismissed).length, 0),
  };
}

function viewPlayer({ id }) {
  const name = decodeURIComponent(id || "");
  const wrap = el(`<div><button class="back-link" data-nav="players">\u2190 Player ratings</button></div>`);
  const pl = confirmedSquad().find((p) => p.name === name);
  const rec = playerRecord(name);
  const season = db.seasonRatings().find((r) => r.player_name === name);
  const sub = [pl?.position, pl?.number ? `Shirt ${pl.number}` : "",
    pl?.loan?.from ? `on loan from ${pl.loan.from}` : ""].filter(Boolean).join(" \u00B7 ");

  wrap.append(el(`
    <div class="hub-hero">
      <div class="hub-hero__text">
        <h1>${esc(name)}${pl?.loan ? ` <span class="squad__loan">Loan</span>` : ""}</h1>
        <p>${esc(sub || "Named on a team sheet this season")}</p>
      </div>
    </div>`));

  /* Keyed on shirt number rather than name: the pen pics and the club's squad
     sheet do not always spell one the same way. */
  const bio = pl?.number != null ? state.bios?.players?.[String(pl.number)] : null;
  if (bio) {
    wrap.append(el(`
      <div class="card">
        <p class="club-overview">${esc(bio.bio)}</p>
        <p class="bio-credit">Player bio by ${esc(state.bios.credit)}</p>
      </div>`));
  }

  if (!rec.games.length) {
    /* Nothing this season does not mean nothing at all. Somebody arriving from
       the archive has a career here even if they have not played since 2019,
       so fill it in rather than telling them there is nothing to see. */
    const box = el(`<div></div>`);
    wrap.append(box);
    ensureArchive().then(() => {
      const past = state.archiveIndex?.get(name);
      if (!past) {
        box.append(el(`
          <div class="empty">
            <b>Nothing to show yet</b>
            ${esc(name)} has not appeared in a team sheet this season. The record fills in once they play.
          </div>`));
        return;
      }
      const seasons = [...past.seasons].sort();
      box.append(el(`<h2 class="section-title">At Kettering</h2>`));
      box.append(el(`
        <div class="card">
          <div class="info-grid info-grid--3">
            <div class="info"><div class="info__label">Appearances</div><div class="info__value" style="color:var(--accent)">${past.apps}</div></div>
            <div class="info"><div class="info__label">Seasons</div><div class="info__value">${seasons.length}</div></div>
            <div class="info"><div class="info__label">Shirt</div><div class="info__value">${[...past.shirts].sort((a, b) => a - b).join(", ") || "Not known"}</div></div>
          </div>
          <div class="hint">${esc(seasons.join(", "))}. First seen ${esc(fmtDate(past.first))}, last ${esc(fmtDate(past.last))}.</div>
        </div>`));
      box.append(careerDetail(past));
    }).catch(() => {
      box.append(el(`<div class="empty"><b>Nothing to show yet</b>${esc(name)} has not appeared in a team sheet this season.</div>`));
    });
    return wrap;
  }

  wrap.append(el(`<h2 class="section-title">This season</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Appearances</div><div class="info__value">${rec.games.length}</div></div>
        <div class="info"><div class="info__label">Started</div><div class="info__value">${rec.starts}</div></div>
        <div class="info"><div class="info__label">Goals</div><div class="info__value" style="color:var(--accent)">${rec.goals}</div></div>
        <div class="info"><div class="info__label">Fan rating</div><div class="info__value">${season ? season.average : "\u2014"}</div></div>
      </div>
    </div>`));

  if (rec.yellows || rec.reds) {
    wrap.append(el(`<p class="note">${[
      rec.yellows ? `${rec.yellows} booking${rec.yellows === 1 ? "" : "s"}` : "",
      rec.reds ? `${rec.reds} sending off` : "",
    ].filter(Boolean).join(" and ")} this season.</p>`));
  }

  wrap.append(el(`<h2 class="section-title">Game by game</h2>`));
  const card = el(`<div class="card ratings-board"></div>`);
  rec.games.slice().reverse().forEach((g) => {
    const f = g.fixture;
    const marks = [
      g.goals.length ? `${ICON_GOAL} ${g.goals.length}` : "",
      g.cards.filter((c) => !c.dismissed).length ? ICON_YELLOW : "",
      g.cards.some((c) => c.dismissed) ? ICON_RED : "",
      g.sheet && !g.sheet.started ? "sub" : "",
    ].filter(Boolean).join(" ");
    card.append(el(`
      <div class="lb lb--plain">
        <span class="lb__who">
          <span class="lb__name">${esc(clubName(f.opponent))}</span>
          <span class="lb__meta">${esc(fmtDate(f.date, "short"))} \u00B7 ${f.venue === "Home" ? "H" : "A"} ${f.homeScore}-${f.awayScore}${marks ? ` \u00B7 ${marks}` : ""}</span>
        </span>
        <span class="lb__avg">${g.rating ? g.rating.average : ""}</span>
      </div>`));
  });
  wrap.append(card);

  /* Somebody playing now was getting only this season, which is the thinnest
     view of the players we know most about: their whole record is in the same
     index, current season folded in. */
  const older = el(`<div></div>`);
  wrap.append(older);
  ensureArchive().then(() => {
    const past = state.archiveIndex?.get(name);
    if (past) older.append(careerDetail(past));
  }).catch(() => { /* this season stands on its own */ });

  return wrap;
}

/* ============================================================ match events */

/* Goals, cards and the gate, all straight from the league feed. A match with
   nothing recorded renders nothing at all rather than an empty box. */

const ICON_GOAL = "\u26BD";
const ICON_YELLOW = "\u{1F7E8}";
const ICON_RED = "\u{1F7E5}";

function matchEvents(fixture) {
  const ev = fixture.events || { goals: [], cards: [] };
  const gate = fixture.attendance;
  if (!ev.goals.length && !ev.cards.length && !gate) return null;

  const box = el(`<div class="card events"></div>`);

  const line = (icon, e, note) => `
    <div class="event${e.ours ? " event--ours" : ""}">
      <span class="event__icon" aria-hidden="true">${icon}</span>
      <span class="event__name">${esc(e.name)}${note ? ` <span class="event__note">${esc(note)}</span>` : ""}</span>
      <span class="event__min">${e.minute === null ? "" : `${e.minute}'`}</span>
    </div>`;

  /* Naming the other lot reads better than "for them", and on a results page
     weeks later it saves working out who they were playing. */
  const theirs = clubName(fixture.opponent);

  if (ev.goals.length) {
    box.append(el(`<div class="events__head">Goals</div>`));
    ev.goals.forEach((g) => box.append(el(line(ICON_GOAL, g, g.ours ? "" : `for ${theirs}`))));
  }

  if (ev.cards.length) {
    box.append(el(`<div class="events__head">Cards</div>`));
    ev.cards.forEach((c) => {
      const icon = c.dismissed ? ICON_RED : ICON_YELLOW;
      const note = c.second
        ? (c.ours ? "second yellow, off" : `${theirs}, second yellow, off`)
        : c.dismissed
        ? (c.ours ? "sent off" : `${theirs}, sent off`)
        : c.ours
        ? ""
        : `for ${theirs}`;
      box.append(el(line(icon, c, note)));
    });
  }

  if (gate) {
    box.append(el(`
      <p class="events__gate">${Number(gate).toLocaleString("en-GB")} at ${
        esc(fixture.venue === "Home" ? KTFC.ground : fixture.ground || clubName(fixture.opponent))
      }.</p>`));
  }

  return box;
}

/**
 * Last season's gates, for something to measure this season against.
 *
 * A number on its own says nothing: 978 at home is good or bad only next to
 * what came before. Taken from the archive, which holds every season back to
 * 2018/19 with the attendance and the competition for each match.
 *
 * Seasons with a handful of matches are skipped. 2019/20 has one friendly in
 * it and 2020/21 a single behind-closed-doors cup tie, and averaging those
 * against a full season would be worse than saying nothing.
 */
function lastSeasonGates() {
  const a = state.archive;
  if (!a?.matches?.length) return null;

  const by = new Map();
  a.matches.forEach((m) => {
    if (!m.season) return;
    if (!by.has(m.season)) by.set(m.season, { home: [], away: [], comps: new Map() });
    const r = by.get(m.season);
    if (m.competition) r.comps.set(m.competition, (r.comps.get(m.competition) || 0) + 1);
    if (m.att) (m.venue === "Home" ? r.home : r.away).push(m.att);
  });

  const full = [...by.entries()]
    .filter(([, r]) => r.home.length >= 8 || r.away.length >= 8)
    .sort((x, y) => y[0].localeCompare(x[0]));
  if (!full.length) return null;

  const [season, r] = full[0];
  const mean = (list) => (list.length
    ? Math.round(list.reduce((n, g) => n + g, 0) / list.length) : null);
  const comp = [...r.comps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  return { season, comp, home: mean(r.home), away: mean(r.away),
           homeGames: r.home.length, awayGames: r.away.length };
}

/** "up 6%" or "down 12%", or nothing when there is nothing to compare. */
function gateChange(now, then) {
  if (!now || !then) return "";
  const pct = Math.round(((now - then) / then) * 100);
  if (pct === 0) return `<span class="gate-diff">level with last season</span>`;
  const up = pct > 0;
  return `<span class="gate-diff gate-diff--${up ? "up" : "down"}">${
    up ? "\u25B2" : "\u25BC"} ${Math.abs(pct)}% on last season</span>`;
}

/** Goals, cards and gates totted up across every played game so far. */
function seasonStats() {
  const played = fixtures().filter((f) => f.status === "played" && f.events);
  const scorers = new Map();
  const discipline = new Map();
  const gates = [];      /* at Latimer Park */
  const awayGates = [];  /* what we walked into on the road */

  played.forEach((f) => {
    (f.events.goals || []).filter((g) => g.ours).forEach((g) => {
      scorers.set(g.name, (scorers.get(g.name) || 0) + 1);
    });
    (f.events.cards || []).filter((c) => c.ours).forEach((c) => {
      const d = discipline.get(c.name) || { yellows: 0, reds: 0 };
      if (c.dismissed) d.reds += 1;
      else d.yellows += 1;
      discipline.set(c.name, d);
    });
    /* Away gates were being read off the feed and then dropped on the floor.
       Following Kettering away is half the season, and the crowd you stood in
       is as much a part of it as the one at home. */
    if (f.attendance) (f.venue === "Home" ? gates : awayGates).push(f.attendance);
  });

  return {
    played: played.length,
    scorers: [...scorers.entries()].map(([name, goals]) => ({ name, goals }))
      .sort((a, b) => b.goals - a.goals),
    discipline: [...discipline.entries()].map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.reds - a.reds || b.yellows - a.yellows),
    gates,
    awayGates,
  };
}

/* ================================================================= avatars */

/* Initials plus a colour worked out from the name. Everyone used to get the
   same gold gradient, so a page of posts was a page of identical circles. The
   colour is derived, not stored: the same supporter always gets the same one. */

/* Avatars as kits.
 *
 * They were a 30px circle with one of six muddy gradients behind two letters,
 * which said nothing about anybody and looked like a placeholder because it
 * was one. A football app can do better than that without asking anybody to
 * upload a photograph, which would mean hosting and moderating pictures of
 * strangers.
 *
 * Ten colourways and six patterns off the shirt: plain, stripes, hoops,
 * halves, quarters and a sash. Sixty combinations, picked from the name, so
 * the same supporter is the same kit everywhere and two people in a thread are
 * very unlikely to match. Every colourway carries white initials at 5.27 to 1
 * or better, checked on the darker half of the pattern as well as the base.
 */
const AVATAR_KITS = 10;
const AVATAR_PATTERNS = ["plain", "stripes", "hoops", "halves", "quarters", "sash"];

const PATTERN_LABEL = {
  plain: "Plain", stripes: "Stripes", hoops: "Hoops",
  halves: "Halves", quarters: "Quarters", sash: "Sash",
};

/* The ten built-in kits, as offered in the picker. These are the same colours
   as .avatar--t0 to --t9 in the stylesheet, which is where they are used when
   nobody has chosen: change one and change both, or the swatch a supporter
   taps will not be the avatar they get.
   
   Every one was measured to carry white lettering at 5.27 to 1 or better. A
   colour off the picker below them has not been, which is why the lettering
   flips to dark on anything light rather than trusting it. */
const KIT_TONES = [
  "#8e1420", "#5c1030", "#14432c", "#16294d", "#1a3f8f",
  "#3d2263", "#0f3d3a", "#4a1414", "#26303a", "#6b3d09",
];

const initialsFor = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0].charAt(1) || "";
  return (first + last).toUpperCase();
};

const hashName = (name) => {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/* Two different mixes of the same hash, so a name that lands on kit 3 is not
   forced onto pattern 3 as well. */
const toneFor = (name) => hashName(name) % AVATAR_KITS;
const patternFor = (name) =>
  AVATAR_PATTERNS[Math.floor(hashName(name) / AVATAR_KITS) % AVATAR_PATTERNS.length];

/* A fixed set the app ships. Nothing is uploaded, so nothing needs hosting or
   moderating. */
/* A red poppy for a club called the Poppies. The gold rosette that was here
   before read as a flower of some sort but never as a poppy, and sat next to a
   red scarf that looked more like one than it did. Drawn rather than picked
   from the emoji set, so it is the right red on every phone. */
const POPPY_SVG = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
  <g fill="#c8323f">
    <ellipse cx="12" cy="6.6" rx="5.1" ry="4.7"/>
    <ellipse cx="17.4" cy="12" rx="4.7" ry="5.1"/>
    <ellipse cx="12" cy="17.4" rx="5.1" ry="4.7"/>
    <ellipse cx="6.6" cy="12" rx="4.7" ry="5.1"/>
  </g>
  <circle cx="12" cy="12" r="3.5" fill="#7d111b"/>
  <circle cx="12" cy="12" r="1.9" fill="#1b1b1f"/>
</svg>`;

/* The lion from the association's own badge, cut out of the crest so it reads
   as a gold lion rather than a busy roundel at nineteen pixels. Volunteers
   only, so it means something. */
const LION_IMG = `<img class="emblem-img" src="assets/img/lion.png" alt="" width="19" height="19">`;
const ADMIN_IMG = `<img class="emblem-img" src="assets/img/admin-badge.png" alt="" width="19" height="19">`;

/* The emblem set, drawn rather than borrowed.
 *
 * These were emoji. Emoji are drawn by the operating system, so the same
 * choice was a different picture on every phone, none of them in the app's
 * colours, and several of them unreadable at nineteen pixels sitting on a kit.
 *
 * Flat shapes, no strokes, three tones: gold carries the form, deep gold does
 * the shading, cream is the highlight that keeps a shape apart from the kit
 * behind it. Same construction as the poppy above. Every one was checked at
 * nineteen pixels, which is where they actually live, rather than only at the
 * size they were drawn.
 */
const EM_G = "#ddc084";   // gold, the form
const EM_GD = "#a3803f";  // deep gold, shading
const EM_C = "#f4f2ee";   // cream, highlight
const EM_D = "#1b1b1f";   // near black, the holes
const EM_R = "#c8323f";   // poppy red, for the scarf and nothing else

const EM_BALL = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" fill="${EM_C}"/>
    <path fill="${EM_D}" d="M12 6.6l3.4 2.5-1.3 4h-4.2l-1.3-4z"/>
    <path fill="${EM_D}" d="M12 2.9l2.2 1.6-.7 1.2h-3l-.7-1.2zM4.5 8.6l2.4 1.8-.6 1.9-1.9.3-.9-1.6zM19.5 8.6l.9 2.4-.9 1.6-1.9-.3-.6-1.9zM7.5 17.4l1.6.5.9 2.3-1.6.9-2-1.7zM16.5 17.4l1 2 -2 1.7-1.6-.9.9-2.3z"/>
  </svg>`;

/* Held up rather than hanging. The draped version's loop swallowed its own
   tails at picker size and read as a horseshoe; held up it is one strong
   shape, and the tilt is what keeps it from reading as the ticket.
   
   Red rather than gold, in the poppy's own red. A Kettering scarf is red, and
   with the poppy that makes two of the fourteen that are, which is enough for
   them to look deliberate rather than like a mistake. */
const EM_SCARF = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <g transform="rotate(-11 12 12)">
      <rect x="3.2" y="8.8" width="17.6" height="6.4" rx="1" fill="${EM_R}"/>
      <rect x="7.6" y="8.8" width="3.1" height="6.4" fill="${EM_C}"/>
      <rect x="13.9" y="8.8" width="3.1" height="6.4" fill="${EM_C}"/>
      <g fill="${EM_C}">
        <rect x="1.3" y="9.3" width="1.9" height="1.3" rx="0.55"/>
        <rect x="1.3" y="11.35" width="1.9" height="1.3" rx="0.55"/>
        <rect x="1.3" y="13.4" width="1.9" height="1.3" rx="0.55"/>
        <rect x="20.8" y="9.3" width="1.9" height="1.3" rx="0.55"/>
        <rect x="20.8" y="11.35" width="1.9" height="1.3" rx="0.55"/>
        <rect x="20.8" y="13.4" width="1.9" height="1.3" rx="0.55"/>
      </g>
    </g>
  </svg>`;

const EM_SHIRT = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M8.8 3.2h6.4l5.2 2.6-2 4.6-2.2-1v11.4H6.8V9.4l-2.2 1-2-4.6z"/>
    <path fill="${EM_D}" d="M8.8 3.2h6.4l-.5 1.4A3.6 3.6 0 0 1 12 6a3.6 3.6 0 0 1-2.7-1.4z"/>
    <rect x="10.7" y="10.6" width="2.6" height="10.2" fill="${EM_D}"/>
  </svg>`;

const EM_BOOTS = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M3.4 4.6h4.2v7.2l9 2.6a3.4 3.4 0 0 1 2.4 3.2v1.2H3.4z"/>
    <path fill="${EM_C}" d="M8.6 12.2l8 2.3-.4 1.5-8-2.3z"/>
    <rect x="2.4" y="18.8" width="18.6" height="1.9" rx="0.95" fill="${EM_D}"/>
    <g fill="${EM_D}">
      <rect x="4.6" y="20.7" width="2.3" height="1.5" rx="0.6"/>
      <rect x="10" y="20.7" width="2.3" height="1.5" rx="0.6"/>
      <rect x="15.4" y="20.7" width="2.3" height="1.5" rx="0.6"/>
    </g>
  </svg>`;

const EM_TROPHY = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M7 3h10v5.6a5 5 0 0 1-10 0z"/>
    <path fill="${EM_GD}" d="M17 4.2h3.2v2.2a3.4 3.4 0 0 1-3.2 3.4V8zM7 4.2H3.8v2.2A3.4 3.4 0 0 0 7 9.8V8z"/>
    <rect x="10.6" y="13.2" width="2.8" height="4" fill="${EM_GD}"/>
    <rect x="7" y="17" width="10" height="2.2" rx="0.8" fill="${EM_G}"/>
    <rect x="5.6" y="19.2" width="12.8" height="2.2" rx="0.9" fill="${EM_GD}"/>
  </svg>`;

const EM_BUS = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <rect x="2.4" y="4.4" width="19.2" height="13" rx="2.6" fill="${EM_G}"/>
    <rect x="4.4" y="6.6" width="6.4" height="4.6" rx="1" fill="${EM_D}"/>
    <rect x="13.2" y="6.6" width="6.4" height="4.6" rx="1" fill="${EM_D}"/>
    <rect x="4.4" y="13" width="15.2" height="1.8" rx="0.9" fill="${EM_GD}"/>
    <circle cx="6.8" cy="18.6" r="2.4" fill="${EM_D}"/>
    <circle cx="17.2" cy="18.6" r="2.4" fill="${EM_D}"/>
  </svg>`;

const EM_PINT = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M6 7.6h9.6l-1.1 12.2a1.6 1.6 0 0 1-1.6 1.4H8.7a1.6 1.6 0 0 1-1.6-1.4z"/>
    <path fill="${EM_C}" d="M5.8 4.6a2.3 2.3 0 0 1 2.4-1.8 2.4 2.4 0 0 1 4 0 2.3 2.3 0 0 1 2.5 1.8 2 2 0 0 1-.4 3.4H6.2a2 2 0 0 1-.4-3.4z"/>
    <path fill="${EM_GD}" d="M16.2 9.4h2a2.6 2.6 0 0 1 0 5.2h-2.4l.2-2h2.2a.6.6 0 0 0 0-1.2h-2.2z"/>
  </svg>`;

const EM_TICKET = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M2.6 6.4h18.8v3.2a2.4 2.4 0 0 0 0 4.8v3.2H2.6v-3.2a2.4 2.4 0 0 0 0-4.8z"/>
    <rect x="9.4" y="8.6" width="1.8" height="6.8" rx="0.9" fill="${EM_D}"/>
    <rect x="13.6" y="10" width="4.4" height="1.5" rx="0.75" fill="${EM_D}"/>
    <rect x="13.6" y="12.6" width="4.4" height="1.5" rx="0.75" fill="${EM_D}"/>
  </svg>`;

const EM_FLAG = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <rect x="4" y="2.4" width="2.2" height="19.2" rx="1.1" fill="${EM_C}"/>
    <path fill="${EM_G}" d="M6.9 3.4h12.8l-3 4.3 3 4.3H6.9z"/>
  </svg>`;

/* Side on, and the third attempt. Front on with tension lugs turned into a
   starburst at thirty two pixels, which is the star already in this set; two
   crossed sticks over a drum head read as a cancel symbol. This is the
   conventional shape, with the ropes bold enough to carry it and the skin
   showing on the near end so it is not a barrel. */
const EM_DRUM = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <rect x="4.6" y="9.4" width="14.8" height="9.2" fill="${EM_G}"/>
    <ellipse cx="4.6" cy="14" rx="2.3" ry="4.6" fill="${EM_GD}"/>
    <g fill="${EM_D}">
      <path d="M7.6 9.6l2.9 4.4-2.9 4.4-1.5 0 2.9-4.4-2.9-4.4z"/>
      <path d="M12.4 9.6l2.9 4.4-2.9 4.4-1.5 0 2.9-4.4-2.9-4.4z"/>
    </g>
    <ellipse cx="19.4" cy="14" rx="2.4" ry="4.6" fill="${EM_C}"/>
    <ellipse cx="19.4" cy="14" rx="1.2" ry="3" fill="${EM_GD}"/>
    <rect x="12.6" y="1.4" width="1.9" height="8.6" rx="0.95"
      transform="rotate(34 13.5 5.7)" fill="${EM_C}"/>
  </svg>`;

const EM_STAR = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path fill="${EM_G}" d="M12 2.4l2.9 6.1 6.7.9-4.9 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.4 9.4l6.7-.9z"/>
  </svg>`;

const EMBLEMS = {
  poppy: POPPY_SVG,
  ball: EM_BALL,
  scarf: EM_SCARF,
  shirt: EM_SHIRT,
  boots: EM_BOOTS,
  trophy: EM_TROPHY,
  bus: EM_BUS,
  pint: EM_PINT,
  ticket: EM_TICKET,
  flag: EM_FLAG,
  drum: EM_DRUM,
  star: EM_STAR,
  lion: LION_IMG,
  admin: ADMIN_IMG,
};

const EMBLEM_LABEL = {
  poppy: "Poppy", ball: "Football", scarf: "Scarf", shirt: "Shirt",
  boots: "Boots", trophy: "Trophy", bus: "Coach", pint: "Pint",
  ticket: "Ticket", flag: "Flag", drum: "Drum", star: "Star",
  lion: "KTFCSA lion",
  admin: "Admin crest",
};

/** The lion is the association's own mark, so only volunteers can wear it. */
/* Badges that say something about who you are rather than what you like. The
   database refuses these to anyone who is not a volunteer, so a hidden button
   is not the only thing stopping it. */
const ADMIN_ONLY_EMBLEMS = new Set(["lion", "admin"]);

/** One avatar: their badge if they picked one, otherwise initials in colour. */
/* ---- kit colours a supporter picked, rather than ones we guessed --------- */

const hex2rgb = (h) => {
  const v = String(h).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

/** WCAG relative luminance, which is what decides light or dark lettering. */
function luminance(hex) {
  const f = (c) => (c / 255 <= 0.03928
    ? c / 255 / 12.92
    : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hex2rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrastWith = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Dark or white lettering, whichever reads better on this colour. */
const inkFor = (hex) =>
  (contrastWith(hex, "#14140f") >= contrastWith(hex, "#ffffff") ? "dark" : "light");

/**
 * Nudge a chosen colour until the lettering on it is readable.
 *
 * There is a band in the middle where neither white nor near-black clears 4.5
 * to 1: a bright red like #e13c2d tops out at 4.30 whichever you use. Refusing
 * the colour would be the wrong answer to somebody who just wants their own
 * shade, so it is darkened a step at a time until it clears. Nothing outside
 * that band is touched, which is every one of the ten built-in kits and almost
 * anything anybody would actually pick.
 */
function readableKit(hex) {
  let out = hex;
  for (let i = 0; i < 12; i++) {
    if (Math.max(contrastWith(out, "#14140f"), contrastWith(out, "#ffffff")) >= 4.5) return out;
    const [r, g, b] = hex2rgb(out).map((c) => Math.round(c * 0.9));
    out = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return out;
}

/** The second tone in a striped or hooped kit, from the one that was chosen. */
function partnerTone(hex) {
  const light = luminance(hex) > 0.3;   /* which way to shift, not a text choice */
  const mix = (c) => Math.max(0, Math.min(255, Math.round(
    light ? c * 0.72 : c + (255 - c) * 0.28)));
  const [r, g, b] = hex2rgb(hex).map(mix);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A supporter's avatar.
 *
 * Colour and pattern are theirs if they have chosen, and worked out from their
 * name if they have not, which is what everybody has until they open the
 * picker. Nobody's avatar changes underneath them.
 *
 * A chosen colour cannot be trusted to carry white lettering: the ten built-in
 * kits were all measured, a colour off a picker was not. The initials flip to
 * near-black on anything light, and the scrim behind an emblem deepens to
 * match, because the emblems are drawn in gold and cream and both disappear on
 * a pale kit.
 */
function avatarHtml(name, profileId, style = "") {
  const emblem = profileId ? db.avatarOf(profileId) : null;
  const badge = emblem && EMBLEMS[emblem];
  let kit = profileId ? db.kitOf(profileId) : null;
  const pattern = (profileId && db.patternOf(profileId)) || patternFor(name);

  /* A chosen emblem still sits on that supporter's kit rather than on a flat
     grey square, so the two kinds of avatar look like they belong together. */
  const cls = `avatar${kit ? "" : ` avatar--t${toneFor(name)}`} avatar--${pattern}${
    badge ? " avatar--emblem" : ""}`;

  let own = "";
  if (kit) {
    kit = readableKit(kit);
    /* Whichever of the two actually wins, not whichever a threshold guesses.
       A fixed cut-off put white lettering on mid grey at 4.00, under the 4.5
       body text needs, when dark on the same grey managed 4.75. */
    const light = inkFor(kit) === "dark";
    own = `--kit-a:${kit};--kit-b:${partnerTone(kit)};` +
          `color:${light ? "#14140f" : "#fff"};` +
          `--scrim:rgba(0,0,0,${light ? 0.5 : 0.34});`;
    if (light) own += "text-shadow:0 1px 2px rgba(255,255,255,0.5);";
  }

  return `<span class="${cls}" title="${esc(name || "")}"${
    own || style ? ` style="${own}${style}"` : ""}><span class="avatar__mark">${
    badge || esc(initialsFor(name))}</span></span>`;
}

/** How far a conversation can nest. The database enforces the same number. */
const MAX_REPLY_DEPTH = 3;

/* ============================================================ match threads */

/* A discussion topic opens for every fixture without anyone creating one.
   Threads are worked out from the fixture list, so cup ties and rearranged
   games get one automatically and nothing has to be tidied up afterwards. */

const THREAD_OPENS_DAYS = 5;  // build-up starts this long before kick-off
const THREAD_CLOSES_DAYS = 5; // reaction stays open this long after

function threadsFor(fixture) {
  const ko = kickoffTime(fixture);
  if (!ko) return [];
  const now = Date.now();
  const opponent = clubName(fixture.opponent);
  const where = fixture.venue === "Home" ? "at home to" : "away at";

  const out = [];
  const opensAt = ko.getTime() - THREAD_OPENS_DAYS * 86400000;
  const closesAt = ko.getTime() + THREAD_CLOSES_DAYS * 86400000;

  if (now >= opensAt && now < ko.getTime()) {
    out.push({
      id: `pre:${fixture.id}`,
      kind: "pre",
      fixture,
      title: `Build-up: ${opponent}`,
      blurb: `Team news, travel and how you see it going ${where} ${opponent}.`,
    });
  }

  if (now >= ko.getTime() && now < closesAt) {
    const played = fixture.status === "played" && fixture.homeScore !== null;
    out.push({
      id: `post:${fixture.id}`,
      kind: "post",
      fixture,
      title: `Reaction: ${opponent}`,
      blurb: played
        ? `${fixture.homeScore} - ${fixture.awayScore}. What did you make of that?`
        : `How is it going ${where} ${opponent}?`,
    });
  }

  return out;
}

/** Every thread currently open, soonest kick-off first. */
function openThreads() {
  return fixtures()
    .flatMap(threadsFor)
    .sort((a, b) => (a.fixture.date + a.fixture.kickoff).localeCompare(b.fixture.date + b.fixture.kickoff));
}

function findThread(id) {
  const fixtureId = id.replace(/^(pre|post):/, "");
  const fixture = fixtures().find((f) => String(f.id) === fixtureId);
  if (!fixture) return null;
  return threadsFor(fixture).find((t) => t.id === id) || null;
}

const threadPosts = (id) => db.list("wall").filter((p) => p.thread === id && !p.replyTo);

function threadCard(t) {
  const count = threadPosts(t.id).length;
  const card = el(`
    <button class="club-row" data-thread="${esc(t.id)}">
      <span class="thread__tag thread__tag--${t.kind}">${t.kind === "pre" ? "Build-up" : "Reaction"}</span>
      <span style="flex:1;min-width:0">
        <span class="club-row__name">${esc(t.title)}</span>
        <span class="club-row__sub">${esc(fmtDate(t.fixture.date, "short"))} · ${esc(t.fixture.kickoff || "TBC")} · ${
          count ? `${count} post${count === 1 ? "" : "s"}` : "no posts yet"
        }</span>
      </span>
      <span style="color:var(--text-3)">›</span>
    </button>`);
  card.addEventListener("click", () => go("thread", { id: t.id }));
  return card;
}

function viewThread({ id }) {
  const t = findThread(id);
  const wrap = el(`<div></div>`);

  if (!t) {
    wrap.append(el(`<button class="back-link" data-nav="wall">← Fan Wall</button>`));
    wrap.append(el(`<div class="empty"><b>That discussion has closed</b>Threads run from five days before a game to five days after.</div>`));
    return wrap;
  }

  wrap.append(el(`<button class="back-link" data-nav="wall">← Fan Wall</button>`));
  wrap.append(el(`
    <div class="hub-hero">
      ${t.fixture.opponentCrest ? `<img class="hub-hero__crest" src="${esc(t.fixture.opponentCrest)}" alt="">` : ""}
      <div class="hub-hero__text">
        <h1>${esc(t.title)}</h1>
        <p>${esc(t.blurb)}</p>
      </div>
    </div>`));

  /* Reaction threads carry the ratings for that game, so marking the players
     and saying your piece happen in the same place. */
  if (t.kind === "post") {
    const ev = matchEvents(t.fixture);
    if (ev) {
      wrap.append(el(`<h2 class="section-title">How it went</h2>`));
      wrap.append(ev);
    }
    const { players } = squadFor(t.fixture);
    if (players.length || db.isAdmin()) {
      wrap.append(el(`<h2 class="section-title">Rate the players</h2>`));
      wrap.append(ratingPanel(t.fixture, { withEvents: false }));
    }

    /* Below the ratings, never between a supporter and what they came for. */
    if (t.fixture.venue === "Away" && t.fixture.team && db.didAttend(t.fixture.id)) {
      const ask = groundPrompt(t.fixture.team, t.fixture);
      if (ask) wrap.append(ask);
      /* Only one prompt at a time. Two questionnaires under a match thread is
         a form, not a conversation. */
      /* One prompt at a time, in order of how hard the answer is to get
         anywhere else. Three questionnaires under a match thread is a form. */
      if (!ask) {
        const next = parkingPrompt(t.fixture.team, t.fixture)
          || pubPrompt(t.fixture.team, t.fixture);
        if (next) wrap.append(next);
      }
    }
  }

  wrap.append(composer(t.id));

  const posts = threadPosts(t.id).filter((p) => !p.hidden || db.isModerator());
  if (!posts.length) {
    wrap.append(el(`<div class="empty"><b>Nothing posted yet</b>Get the conversation going.</div>`));
  } else {
    posts.forEach((p) => wrap.append(wallCard(p, db.isModerator())));
  }

  return wrap;
}

/** A reply: the same post, drawn quieter and tucked under its parent. */
/* `mod`: hiding a reply is moderation, not administration. */
function replyCard(p, mod, depth = 1) {
  const card = el(`
    <div class="reply" ${p.hidden ? 'style="opacity:.5"' : ""}>
      <div class="post__head">
        ${avatarHtml(p.authorName, p.authorId)}
        ${p.authorId
          ? `<button class="post__who post__who--link" data-supporter="${esc(String(p.authorId))}"
               >${esc(p.authorName)}</button>`
          : `<span class="post__who">${esc(p.authorName)}</span>`}
        ${db.isVolunteer(p.authorId) ? `<span class="pill pill--vol" title="Runs this site">Admin</span>` : ""}
        ${!db.isVolunteer(p.authorId) && db.isContributor(p.authorId)
          ? `<span class="pill pill--contrib" title="Has added ground or access information">Contributor</span>` : ""}
        ${p.hidden ? `<span class="pill pill--off">Hidden</span>` : ""}
        <span class="post__when">${esc(relTime(p.createdAt))}</span>
      </div>
      <div class="post__body">${esc(p.text)}</div>
      <div class="post__actions">
        ${depth < MAX_REPLY_DEPTH ? `<button class="link-btn" data-act="reply">Reply</button>` : ""}
        <button class="link-btn" data-act="report">Report</button>
        ${mod ? `<button class="link-btn" data-act="hide">${p.hidden ? "Unhide" : "Hide"}</button>` : ""}
        ${db.canEdit(p) ? `<button class="link-btn" data-act="del">Delete</button>` : ""}
      </div>
      <div class="replies"></div>
    </div>`);

  /* Its own answers, then a box to add one. Stops at MAX_REPLY_DEPTH, which
     the database enforces too, so a stale tab cannot get past it. */
  const holder = card.querySelector(".replies");
  db.list("wall")
    .filter((r) => r.replyTo === p.id && (!r.hidden || mod))
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((r) => holder.append(replyCard(r, mod, depth + 1)));

  const replyBtn = card.querySelector('[data-act="reply"]');
  if (replyBtn) {
    replyBtn.addEventListener("click", () => {
      const existing = card.querySelector(":scope > .replies > .reply-box");
      if (existing) {
        const ta = existing.querySelector("textarea");
        return ta && ta.focus();
      }
      const box = composer(p.thread || null, { replyTo: p.id, onDone: () => box.remove() });
      box.classList.add("reply-box");
      holder.append(box);
      const ta = box.querySelector("textarea");
      if (ta) ta.focus();
    });
  }

  const act = (name, fn) => {
    const b = card.querySelector(`[data-act="${name}"]`);
    if (b) b.addEventListener("click", fn);
  };
  act("report", () => {
    db.update("wall", p.id, { reports: (p.reports || 0) + 1 });
    toast("Reported. A volunteer will take a look.", "good");
  });
  act("hide", () => db.update("wall", p.id, { hidden: !p.hidden }));
  act("del", () => db.drop("wall", p.id));
  return card;
}

/** The post box, shared by the open wall and by each match thread. */
function composer(thread = null, { replyTo = null, onDone = null } = {}) {
  const user = db.currentUser();
  if (!user) {
    return el(`<div class="notice notice--info">Sign in to ${replyTo ? "reply" : "post"}. All it needs is a name.</div>`);
  }

  /* Several of these can be on screen at once now that every post can be
     replied to, so the ids have to be unique or the labels point at the wrong
     box and screen readers read the wrong thing. */
  const uid = `c${Math.random().toString(36).slice(2, 8)}`;

  const box = el(`
    <div class="card" style="margin-bottom:16px">
      <label for="${uid}-text" class="sr-only">${replyTo ? "Your reply" : "Your message"}</label>
      <textarea id="${uid}-text" maxlength="600" placeholder="${
        replyTo ? "Reply to this" : thread ? "Have your say on this one." : "What did you make of that, then?"
      }"></textarea>
      <div class="char-count" id="${uid}-count">0 / 600</div>
      <div class="btn-row">
        <button class="btn btn--sm" id="${uid}-post">${replyTo ? "Reply" : "Post"}</button>
        ${replyTo ? `<button class="btn btn--sm btn--ghost" id="${uid}-cancel">Cancel</button>` : ""}
      </div>
    </div>`);

  const ta = $(`#${uid}-text`, box);
  const count = $(`#${uid}-count`, box);
  ta.addEventListener("input", () => {
    count.textContent = `${ta.value.length} / 600`;
    count.classList.toggle("is-over", ta.value.length > 600);
  });

  const cancel = $(`#${uid}-cancel`, box);
  if (cancel) cancel.addEventListener("click", () => (onDone ? onDone() : box.remove()));

  $(`#${uid}-post`, box).addEventListener("click", () => {
    /* A reply goes through exactly the same checks as a post. */
    const check = db.checkPost(ta.value);
    if (!check.ok) return toast(check.reason, "bad");
    const limit = db.rateLimit("wall", { max: 5, windowMs: 120000 });
    if (!limit.ok) return toast(limit.reason, "bad");
    db.add("wall", { text: ta.value.trim(), thread, replyTo });
    ta.value = "";
    toast(replyTo ? "Replied." : "Posted.", "good");
    if (onDone) onDone();
    render();
  });
  return box;
}

/* ================================================================ fan wall */

/**
 * What you have missed, at the top of the wall.
 *
 * A badge tells you there is something; this tells you what, and takes you to
 * it. Marked as seen once it has been shown, so opening the wall is what
 * clears it rather than some separate act of dismissal.
 */
function replyInbox() {
  const box = el(`<div></div>`);
  if (!db.currentUser()) return box;

  db.unseenReplies().then((rows) => {
    if (!rows.length) return;
    const card = el(`
      <div class="card inbox">
        <div class="inbox__head">${rows.length} ${
          rows.length === 1 ? "reply" : "replies"} while you were away</div>
      </div>`);

    rows.slice(0, 6).forEach((r) => {
      const row = el(`
        <button class="inbox__row"${r.thread ? ` data-thread="${esc(r.thread)}"` : ""}>
          <span class="inbox__who">${esc(r.author_name)}</span>
          <span class="inbox__text">${esc(r.text)}</span>
          <span class="inbox__on">on your post: ${esc(String(r.parent_text).slice(0, 60))}${
            String(r.parent_text).length > 60 ? "\u2026" : ""}</span>
        </button>`);
      if (r.thread) {
        row.addEventListener("click", () => go("thread", { id: r.thread }));
      }
      card.append(row);
    });
    if (rows.length > 6) {
      card.append(el(`<p class="hint">And ${rows.length - 6} more further down.</p>`));
    }
    box.append(card);

    /* Cleared on sight. Coming to the wall is the act of reading them, and a
       separate "mark as read" would be one more thing to tap for no gain. */
    db.markWallSeen().then(() => { replyWaiting = 0; renderNav(); });
  }).catch(() => { /* the wall is fine without it */ });

  return box;
}

/* ---------------------------------------------------------------- meeting */

/**
 * The first supporters meeting.
 *
 * 181 of the 199 who answered the consultation wanted one. That is the mandate
 * and the page says so, because a meeting called by a working group nobody
 * elected needs to point at the reason it is being called.
 *
 * It works before there is a date. The headcount is what decides the venue, and
 * a room costs seventy five pounds, so the count comes first and the booking
 * second rather than the other way round.
 */
function viewMeeting() {
  const wrap = el(`<div></div>`);
  wrap.append(el(`
    <div class="page-head page-head--airy">
      <h1>The first supporters meeting</h1>
      <p>In the consultation, <b>181 of 199</b> supporters said they wanted one: 118 in a room,
         71 online, and 31 who could not come but asked to be kept posted. This is us getting
         on with it.</p>
    </div>`));

  const box = el(`<div><div class="skeleton" style="height:220px"></div></div>`);
  wrap.append(box);

  db.meetings().then((rows) => {
    box.replaceChildren();
    const live = rows.filter((m) => m.status !== "done");
    if (!live.length) {
      box.append(el(`
        <div class="card">
          <p class="club-overview" style="margin:0">Nothing is booked yet. The date and the venue
          go here as soon as they are settled, and anybody who has said they are coming gets told
          first.</p>
        </div>`));
      return;
    }
    live.forEach((m) => box.append(meetingCard(m)));
  }).catch(() => {
    box.replaceChildren();
    box.append(el(`<div class="empty"><b>Could not load it</b>Try again in a moment.</div>`));
  });

  return wrap;
}

function meetingCard(m) {
  const card = el(`<div class="card meeting"></div>`);
  const planning = m.status === "planning";

  card.append(el(`<h2 class="meeting__title">${esc(m.title)}</h2>`));

  /* Where, when, and how many. Nulls are the normal state early on and say so
     rather than showing an empty row. */
  const rows = [
    /* 7:30pm, not 19:30. Nobody arranging to meet in a pub says nineteen
       thirty, and this is read by supporters rather than by a timetable. */
    ["When", m.held_at
      ? `${fmtDate(String(m.held_at).slice(0, 10))}, ${
          new Date(m.held_at).toLocaleTimeString("en-GB", {
            hour: "numeric", minute: "2-digit", hour12: true })
            .replace(":00", "").replace(" ", "")}`
      : "Not settled yet"],
    ["Where", m.venue ? `${esc(m.venue)}${m.address ? `, ${esc(m.address)}` : ""}` : "Not settled yet"],
  ];
  if (m.online_url) rows.push(["Online", "There is a link for anybody who cannot get there"]);

  const slip = el(`<div class="sent-slip"></div>`);
  rows.forEach(([k, v]) => slip.append(el(
    `<div class="sent-slip__row"><span>${esc(k)}</span><b>${v}</b></div>`)));
  card.append(slip);

  if (planning) {
    card.append(el(`<p class="hint">Nothing is booked. A room costs money, and how big a
      room depends on how many are coming, so the count comes first.</p>`));
  }

  /* The count. Public, because it is what decides whether the room gets
     booked, and everybody paying for it should be able to see it. */
  const total = (m.in_person || 0) + (m.online || 0);
  card.append(el(`
    <div class="info-grid info-grid--3 meeting__counts">
      <div class="info"><div class="info__label">In the room</div>
        <div class="info__value" style="color:var(--accent)">${m.in_person || 0}</div></div>
      <div class="info"><div class="info__label">Online</div>
        <div class="info__value">${m.online || 0}</div></div>
      <div class="info"><div class="info__label">Keep me posted</div>
        <div class="info__value">${m.cannot || 0}</div></div>
    </div>`));

  /* Only once anybody has answered. A food count of nought sitting under an
     empty room says nothing and looks like a failure. */
  if ((m.eating || 0) + (m.not_eating || 0) > 0) {
    card.append(el(`<p class="hint meeting__food"><b>${m.eating || 0}</b> would eat on the
      night${m.not_eating ? `, ${m.not_eating} would not` : ""}. That is the number
      No. 1 Smash &amp; Grab need before they commit.</p>`));
  }

  if (m.capacity) {
    const left = m.capacity - (m.in_person || 0);
    card.append(el(`<p class="hint">${left > 0
      ? `${left} place${left === 1 ? "" : "s"} left in the room, of ${m.capacity}.`
      : `The room is full. Say you are coming anyway and we will look at a bigger one.`}</p>`));
  }

  if (m.note) card.append(el(`<p class="club-overview">${esc(m.note)}</p>`));

  card.append(rsvpPanel(m, total));

  /* The list, and a way to get the addresses out. Volunteers only: the policy
     on meeting_rsvps refuses everybody else, so for a supporter this asks for
     nothing and appends nothing. */
  if (db.isModerator()) card.append(rsvpList(m));

  return card;
}

/**
 * Who has said they are coming, for whoever has to book the room and tell
 * people if it changes.
 *
 * The addresses come out semicolon separated, which is what a mail client
 * wants pasted into Bcc. Bcc rather than To, and the button says so: a hundred
 * supporters' email addresses shown to each other is a data breach somebody
 * has to report, not a mistake you tidy up afterwards.
 */
function rsvpList(m) {
  const box = el(`<div class="rsvp-list"></div>`);

  db.meetingList(m.meeting_id).then((rows) => {
    if (!rows.length) {
      box.append(el(`<p class="hint">Nobody has said yet.</p>`));
      return;
    }

    const label = { in_person: "In the room", online: "Online", cannot: "Keeping posted" };
    const mails = [...new Set(rows.map((r) => (r.email || "").trim().toLowerCase())
      .filter((e) => e.includes("@")))];

    box.append(el(`<div class="info__label">Who has said</div>`));

    ["in_person", "online", "cannot"].forEach((kind) => {
      const some = rows.filter((r) => r.coming === kind);
      if (!some.length) return;
      box.append(el(`<p class="rsvp-list__group"><b>${esc(label[kind])} (${some.length})</b>
        ${esc(some.map((r) => r.name || "no name given").join(", "))}</p>`));
    });

    const row = el(`<div class="btn-row" style="margin-top:10px"></div>`);
    if (mails.length) {
      const b = el(`<button class="btn btn--sm">Copy ${mails.length} email address${
        mails.length === 1 ? "" : "es"}</button>`);
      b.addEventListener("click", () => {
        const text = mails.join(";");
        copyText(text).then((ok) => {
          if (ok) {
            b.textContent = "Copied \u2014 paste into Bcc";
            setTimeout(() => { b.textContent = `Copy ${mails.length} email addresses`; }, 3000);
            return;
          }
          modal(`
            <h3 style="margin:0 0 8px">${mails.length} addresses</h3>
            <p class="hint" style="margin-bottom:10px">Press and hold to copy, then paste into
              Bcc.</p>
            <textarea readonly rows="6" style="width:100%">${esc(text)}</textarea>`);
        });
      });
      row.append(b);
    }

    const names = el(`<button class="btn btn--sm btn--ghost">Copy the names</button>`);
    names.addEventListener("click", () => {
      const text = rows.map((r) => `${r.name || "no name given"} - ${label[r.coming]}`).join("\n");
      copyText(text).then((ok) => {
        if (ok) { names.textContent = "Copied"; setTimeout(() => { names.textContent = "Copy the names"; }, 2500); }
        else modal(`<h3 style="margin:0 0 8px">The list</h3>
          <textarea readonly rows="10" style="width:100%">${esc(text)}</textarea>`);
      });
    });
    row.append(names);
    box.append(row);

    const without = rows.length - mails.length;
    box.append(el(`<p class="hint">${mails.length} of ${rows.length} left an email${
      without ? `, so ${without} can only be told through the app or Facebook` : ""}.
      <b>Paste into Bcc, never To.</b> Only you and the other volunteers see this.</p>`));
  }).catch(() => { box.append(el(`<p class="hint">Could not read the list.</p>`)); });

  return box;
}

/**
 * Saying you are coming.
 *
 * No account needed, the same as the consultation, because all 118 of the 118
 * who said they would come in person said it without one. Asking them to sign
 * up first would lose most of them and the headcount is the point.
 */
function rsvpPanel(m, total) {
  const box = el(`<div class="rsvp"></div>`);
  const saved = db.read(`rsvp:${m.id}`, null);

  const draw = () => {
    box.replaceChildren();
    if (saved) {
      const said = { in_person: "You are coming, in the room",
                     online: "You are joining online",
                     cannot: "You cannot come, and we will keep you posted" }[saved];
      box.append(el(`<p class="rsvp__done">${esc(said)}. Thank you.</p>`));
      const change = el(`<button class="link-btn">Change that</button>`);
      change.addEventListener("click", () => { db.write(`rsvp:${m.id}`, null); redraw(); });
      box.append(change);
      return;
    }

    box.append(el(`<div class="info__label">Are you coming?</div>`));
    const name = el(`<input class="input rsvp__name" maxlength="40"
      placeholder="Your name, so we know who to expect"
      value="${esc(db.currentUser()?.name || "")}">`);
    box.append(name);

    /* Optional, and for one thing only. Somebody who says they are coming
       without an account leaves us no way to tell them the room has changed,
       and 31 supporters asked in the consultation to be kept posted. Signed in,
       we already have an address and do not ask twice. */
    const mail = db.currentUser() ? null : el(`<input class="input rsvp__mail" type="email"
      maxlength="120" placeholder="Email, only if you want telling of any change">`);
    if (mail) box.append(mail);

    /* Asked of everybody but only meaningful for the room, so it is a tick
       rather than a third button: somebody joining online is not eating a
       burger in Kettering. */
    const food = el(`
      <label class="rsvp__food">
        <input type="checkbox">
        <span>I would eat on the night, if there is food on
          (No. 1 Smash &amp; Grab, pay as you eat)</span>
      </label>`);
    box.append(food);
    const foodBox = food.querySelector("input");

    const row = el(`<div class="btn-row rsvp__row"></div>`);
    [["in_person", "I will be there"],
     ["online", "I would join online"],
     ["cannot", "I cannot make it, keep me posted"]].forEach(([key, label], i) => {
      const b = el(`<button class="btn btn--sm${i ? " btn--ghost" : ""}">${esc(label)}</button>`);
      b.addEventListener("click", async () => {
        row.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        try {
          /* Only sent for somebody who will actually be in the room. Anybody
             else leaves it null, which means not asked rather than no. */
          await db.rsvpMeeting(m.id, key, db.consultDeviceKey(), name.value.trim(),
            mail ? mail.value.trim() : null,
            key === "in_person" ? foodBox.checked : null);
          db.write(`rsvp:${m.id}`, key);
          toast("Thank you. We will let you know.", "good");
          redraw();
        } catch (err) {
          row.querySelectorAll("button").forEach((x) => { x.disabled = false; });
          toast(err.message || "That did not save.", "bad");
        }
      });
      row.append(b);
    });
    box.append(row);
    box.append(el(`<p class="hint">No account needed. Your name is seen only by whoever books
      the room, and the numbers above are all anybody else sees. An email is optional and used
      for one thing: telling you if the night or the room changes. It is not a mailing list and
      it is not added to one.</p>`));
  };

  const redraw = () => { render(); };
  draw();
  return box;
}

/* ------------------------------------------------------------------ tiers */

/**
 * Four rungs, set against what supporters had actually scored three weeks into
 * the season rather than against round numbers.
 *
 * The spread at the time was one account on 279 and then 51, 50, 34, 33, 26,
 * with a median of about eight among everybody scoring at all. Thresholds are
 * pitched so the first rung is within reach of anybody who turns up and joins
 * in for a few weeks, and the top one takes a season. Points reset every 1 July
 * and so do these: a tier is what you have done this season, not a rank you
 * keep.
 *
 * Below the first rung there is no badge at all, deliberately. A label meaning
 * "has done almost nothing" helps nobody.
 */
const TIERS = [
  { at: 250, name: "Legend",                 short: "Legend" },
  { at: 120, name: "Superstar Contributor",  short: "Superstar" },
  { at: 50,  name: "Top Contributor",        short: "Top" },
  { at: 15,  name: "Contributor",            short: "Contributor" },
];

/** The tier a total earns, or null below the bottom rung. */
function tierFor(points) {
  const n = Number(points) || 0;
  return TIERS.find((t) => n >= t.at) || null;
}

/** How far to the next one up, for the nudge on somebody's own card. */
function nextTier(points) {
  const n = Number(points) || 0;
  const up = [...TIERS].reverse().find((t) => n < t.at);
  return up ? { ...up, needs: up.at - n } : null;
}

/**
 * The rung somebody has reached, worn next to their name.
 *
 * Admin wins outright. Whoever runs the site is going to sit near the top of a
 * board they built the scoring for, and "Danny · Legend" reads as marking your
 * own homework however the number was earned. supporterTag() already stands
 * aside for a volunteer for exactly this reason; this now does the same, so a
 * name carries one badge and it is the one that matters.
 *
 * Pass no profileId where there is nobody to check, such as the key in the
 * explainer that lists what each rung takes.
 */
const tierPill = (points, profileId = null) => {
  if (profileId && db.isVolunteer(profileId)) {
    return `<span class="pill pill--vol" title="Runs this site">Admin</span>`;
  }
  const t = tierFor(points);
  return t ? `<span class="tier tier--${t.at}">${esc(t.name)}</span>` : "";
};

/* ------------------------------------------------------------- standing */

/**
 * The boards.
 *
 * Deliberately several rather than one. A single all-time table is owned by
 * whoever joined first and a newcomer can never catch them, so it stops being
 * a reason to do anything. Six boards means six people are top of something,
 * and the ones that reward being at games rather than being on a keyboard sit
 * as high as the rest.
 */
function viewStanding() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Leaderboards</h1>
      <p>Who is top of what, this season. Everything resets on 1 July so it stays winnable.</p>
    </div>
  </div>`);

  const me = db.currentUser();
  if (me) {
    const card = el(`<div class="card"></div>`);
    card.append(el(`<div class="info__label">Your points</div>`));
    const n = el(`<div class="info__value" style="color:var(--accent);font-size:1.875rem">&hellip;</div>`);
    card.append(n);
    const badge = el(`<div></div>`);
    card.append(badge);
    card.append(el(`<p class="hint">
      <button class="link-btn" data-supporter="${esc(String(me.id))}">Your card</button></p>`));
    wrap.append(card);
    db.contributorBoard().then((rows) => {
      const mine = rows.find((r) => String(r.profile_id) === String(me.id));
      const pts = mine ? mine.points : 0;
      n.textContent = String(pts);
      /* No rung to climb if the badge is Admin, or the card would show "Admin"
         and under it how far to Superstar Contributor. */
      const up = db.isVolunteer(me.id) ? null : nextTier(pts);
      badge.innerHTML = `${tierPill(pts, me.id)}${up
        ? `<span class="tier-next">${up.needs} more to ${esc(up.name)}</span>` : ""}`;
    }).catch(() => { n.textContent = "\u2014"; });
  }

  /* Folded shut, because most visits are to look at a board rather than to
     read the rules. Open once and it stays open for the session. */
  const fold = el(`
    <details class="fold"${state.pointsOpen ? " open" : ""}>
      <summary>How Poppies Points work</summary>
      <div class="fold__body"></div>
    </details>`);
  fold.addEventListener("toggle", () => { state.pointsOpen = fold.open; });
  const foldBody = fold.querySelector(".fold__body");
  const info = withPointsInfo((d) => foldBody.append(pointsExplainer(d)));
  if (info === null && !foldBody.childElementCount) {
    foldBody.append(el(`<p class="hint">Loading&hellip;</p>`));
  }
  wrap.append(fold);

  const boards = [
    { title: "Contributors", sub: "Poppies Points this season", tiers: true,
      get: () => db.contributorBoard(), col: (r) => r.points },
    { title: "Prediction League", sub: "Points from called results",
      get: () => db.predictionLeague(), col: (r) => r.points },
    { title: "Grounds visited", sub: "Of the 22 in the division",
      get: () => db.groundBoard(), col: (r) => r.grounds },
    { title: "Poppies Daily", sub: "Current streak",
      get: () => db.quizLeague(), col: (r) => r.streak },
    { title: "Poppies Wordle", sub: "Current streak",
      get: () => db.wordleLeague(), col: (r) => r.streak },
    { title: "Who Played More?", sub: "Best run",
      get: () => db.duelLeague(), col: (r) => r.best },
  ];

  boards.forEach((b) => {
    wrap.append(el(`<h2 class="section-title">${esc(b.title)}</h2>`));
    const card = el(`<div class="card"><p class="hint">${esc(b.sub)}</p></div>`);
    const body = el(`<div class="stand"></div>`);
    card.append(body);
    wrap.append(card);

    Promise.resolve(b.get()).then((rows) => {
      body.textContent = "";
      const live = (rows || []).filter((r) => Number(b.col(r)) > 0).slice(0, 10);
      if (!live.length) {
        body.append(el(`<p class="hint">Nothing on this one yet.</p>`));
        return;
      }
      live.forEach((r, i) => {
        body.append(el(`
          <div class="stand__row">
            <span class="stand__rank${i === 0 ? " stand__rank--1" : ""}">${i + 1}</span>
            <button class="stand__who" data-supporter="${esc(String(r.profile_id))}"
              >${esc(r.display_name)}${b.tiers ? tierPill(b.col(r), r.profile_id) : ""}</button>
            <span class="stand__n">${esc(String(b.col(r)))}</span>
          </div>`));
      });
    }).catch(() => { body.textContent = ""; body.append(el(`<p class="hint">That board did not load.</p>`)); });
  });

  return wrap;
}

/**
 * The explainer itself, built once and used twice: folded shut on the
 * leaderboards page, and open on its own page. Two copies of this would drift
 * within a month.
 */
function pointsExplainer(d, { tiers = true } = {}) {
  const box = el(`<div></div>`);
  box.append(el(`<p class="hint">${esc(d.season)}</p>`));

  if (tiers) {
    const t = el(`<div class="card" style="margin-top:10px"></div>`);
    t.append(el(`<div class="info__label">The rungs</div>`));
    [...TIERS].reverse().forEach((x) => t.append(el(`
      <div class="pts-row">
        <span>${tierPill(x.at)}</span>
        <span class="pts-row__n">${x.at}+</span>
      </div>`)));
    t.append(el(`<p class="hint">They reset with everything else on 1 July. A rung is what you
      have put in this season, not a rank you keep.</p>`));
    box.append(t);
  }

  d.groups.forEach((g) => {
    const card = el(`<div class="card" style="margin-top:10px"></div>`);
    card.append(el(`<div class="info__label">${esc(g.title)}</div>`));
    if (g.why) card.append(el(`<p class="hint" style="margin-top:4px">${esc(g.why)}</p>`));
    g.items.forEach((it) => card.append(el(`
      <div class="pts-row">
        <span>${esc(it.what)}${it.per ? ` <span class="pts-row__per">${esc(it.per)}</span>` : ""}</span>
        <span class="pts-row__n">${it.pts === null ? "varies" : (it.pts > 0 ? `+${it.pts}` : it.pts)}</span>
      </div>`)));
    box.append(card);
  });

  const nots = el(`<div class="card" style="margin-top:10px"></div>`);
  nots.append(el(`<div class="info__label">What points are not</div>`));
  d.notPoints.forEach((t) => nots.append(el(`<p class="club-overview">${esc(t)}</p>`)));
  box.append(nots);
  return box;
}

/** Fetches data/points.json once and hands it back. */
function withPointsInfo(then) {
  if (state.pointsInfo && state.pointsInfo !== true) return then(state.pointsInfo);
  if (state.pointsInfo === null) {
    state.pointsInfo = true;   /* one fetch, not one a render */
    readJSON("data/points.json").then((r) => { state.pointsInfo = r || false; render(); });
  }
  return null;
}

/* ------------------------------------------------------- how points work */

function viewPoints() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>How points work</h1>
      <p>What earns them, and what they are deliberately not for.</p>
    </div>
  </div>`);
  const d = withPointsInfo((info) => wrap.append(pointsExplainer(info)));
  if (d === null && wrap.children.length === 1) {
    wrap.append(el(`<div class="card"><p class="hint">Loading&hellip;</p></div>`));
  }
  return wrap;
}

/* ------------------------------------------------------- supporter profile */

/**
 * One supporter's card, reached by tapping their name anywhere they have
 * posted.
 *
 * It used to print "Moderator" here for anybody carrying the permission, which
 * leaked a permission bit into a public identity. Being able to hide a post is
 * a job somebody does, not a label they wear, and the two want separating:
 * whoever should be publicly badged gets a tag saying so, on purpose. It also
 * meant somebody given the rights to test them was announced to the fanbase as
 * a moderator, which they are not.
 *
 * Everything on it is already public somewhere else: the boards, the grounds
 * map, the prediction league. Nothing new is exposed by gathering it, and
 * gathering it is the point, because a name on a wall post tells you nothing
 * about who you are talking to.
 */
function viewSupporter({ id, from }) {
  const wrap = el(`<div></div>`);
  wrap.append(el(`<button class="back-link" data-nav="${esc(from || "wall")}">\u2190 Back</button>`));

  const me = db.currentUser();
  const mine = me && String(me.id) === String(id);
  const name = supporterName(id) || (mine ? me.name : "Supporter");

  wrap.append(el(`
    <div class="page-head page-head--airy sup-head">
      ${avatarHtml(name, id, "width:56px;height:56px;font-size:20px")}
      <div>
        <h1>${esc(name)}${tierPill(state.supporters?.[id]?.points || 0, id)}</h1>
        <p>${db.isVolunteer(id) ? "Runs this site &middot; " : ""}${
          mine ? "This is you" : "Poppies supporter"}</p>
      </div>
    </div>`));

  /* Three states, not two. `null` means the request is in flight, `false`
     means it came back with nothing. Both used to fall through the same `!sum`
     test, so anybody opening this page by its address rather than by tapping a
     name watched it say "nothing to show yet" while the answer was still on
     its way.
  
     A failure is not cached. It clears the slot so the next render asks again,
     which matters on a cold open where the first paint can beat the backend
     connecting: cache the "no" you get before you are connected and it is the
     only answer that supporter ever gets. */
  state.supporters = state.supporters || {};
  const sum = state.supporters[id];

  if (sum === undefined) {
    if (db.isOnline()) {
      state.supporters[id] = null;                     /* stops a second fetch */
      db.supporterSummary(id)
        .then((r) => { state.supporters[id] = r || false; render(); })
        .catch(() => { delete state.supporters[id]; render(); });
    }
    wrap.append(el(`<div class="card"><p class="hint">Looking that up\u2026</p></div>`));
    return wrap;
  }
  if (sum === null) {
    wrap.append(el(`<div class="card"><p class="hint">Looking that up\u2026</p></div>`));
    return wrap;
  }
  if (!sum) {
    wrap.append(el(`<div class="empty"><b>Nothing to show yet</b>Once they have been to a game or played along, it turns up here.</div>`));
    return wrap;
  }

  /* The headline numbers, only the ones that are actually something. */
  const stats = [];
  if (sum.points) {
    /* Admin outranks the rung here as well. The badge by the name already says
       Admin, and a tile underneath calling the same person Legend contradicts
       it on the same screen. */
    const t = db.isVolunteer(id) ? null : tierFor(sum.points);
    stats.push(["Poppies Points", sum.points, t ? t.name : "this season"]);
  }
  if (sum.grounds?.length) stats.push(["Grounds visited", sum.grounds.length, "of 22"]);
  if (sum.predictPlace) stats.push(["Prediction league", `${ordinal(sum.predictPlace)}`, `of ${sum.predictOf}`]);
  if (sum.quiz?.streak) stats.push(["Poppies Daily", sum.quiz.streak, "day streak"]);
  if (sum.wordle?.streak) stats.push(["Poppies Wordle", sum.wordle.streak, "day streak"]);
  if (sum.duel?.best) stats.push(["Who Played More", sum.duel.best, "best run"]);

  if (!stats.length) {
    wrap.append(el(`<div class="empty"><b>Not much here yet</b>${
      mine ? "Log a game, make a prediction, play the daily, and this fills up."
           : "They have not played along yet."}</div>`));
  } else {
    /* Not info-grid--3. There are between one and six of these depending on
       what somebody has actually done, and a fixed three columns left the
       fourth sitting alone on a row of its own with a hole beside it. This
       fits as many as will go and keeps them even. */
    const grid = el(`<div class="sup-stats"></div>`);
    stats.forEach(([label, value, sub]) => grid.append(el(`
      <div class="info">
        <div class="info__label">${esc(label)}</div>
        <div class="info__value" style="color:var(--accent)">${esc(String(value))}</div>
        <div class="info__sub">${esc(sub)}</div>
      </div>`)));
    const card = el(`<div class="card"></div>`);
    card.append(grid);
    wrap.append(card);
  }

  /* Your own card shows where the points came from. Nobody else's does: what
     somebody has and has not filled in is their business. */
  if (mine) {
    wrap.append(el(`<h2 class="section-title">Where your points came from</h2>`));
    const box = el(`<div class="card"></div>`);
    box.append(el(`<p class="hint">Points are for what you have put into the app this season. They
      are not a measure of being a supporter, and they count for nothing anywhere it matters:
      not the consultation, not a poll, not anything the Association reports.
      <button class="link-btn" data-nav="points">How points work</button></p>`));
    const list = el(`<div class="pts-list"></div>`);
    box.append(list);
    wrap.append(box);

    db.myPoints().then((rows) => {
      list.textContent = "";
      if (!rows.length) {
        list.append(el(`<p class="hint">Nothing yet this season.</p>`));
        return;
      }
      rows.forEach((r) => list.append(el(`
        <div class="pts-row">
          <span>${esc(r.source)}</span>
          <span class="pts-row__n">${r.points > 0 ? "+" : ""}${r.points}</span>
        </div>`)));
    }).catch(() => { list.append(el(`<p class="hint">That did not load.</p>`)); });
  }

  return wrap;
}

/** Their display name, from anywhere on the wall they have posted. */
function supporterName(id) {
  const hit = db.list("wall").find((p) => String(p.authorId) === String(id));
  if (hit) return hit.authorName;
  const t = (state.topics || []).find((x) => String(x.authorId) === String(id));
  return t ? t.authorName : null;
}

/* ---------------------------------------------------------------- topics */

/** The six a supporter can choose from. Few enough to fit on a phone. */
const TOPIC_CATS = [
  { key: "matchday", label: "Matchday",         hint: "The game itself" },
  { key: "tickets",  label: "Tickets & Travel", hint: "Getting there, spares, lifts" },
  { key: "ground",   label: "Club & Ground",    hint: "The club, Latimer Park, the league" },
  { key: "memories", label: "Memories",         hint: "Old games, old players" },
  { key: "market",   label: "Buy, Sell, Swap",  hint: "Shirts, programmes, badges" },
  { key: "other",    label: "Anything else",    hint: "Whatever it is" },
];
const catLabel = (k) => TOPIC_CATS.find((c) => c.key === k)?.label || "Anything else";

/**
 * The topic list.
 *
 * Ordered by last activity rather than when it started, which is most of what
 * makes a place feel alive: a thread somebody answered this morning belongs
 * above one started last week and ignored. The database does that ordering, so
 * the browser only draws it.
 */
function topicList() {
  const box = el(`
    <section class="wall-block">
      <div class="wall-block__head">
        <h2>Topics</h2>
        <span>Anything you want to talk about, started by supporters</span>
      </div>
    </section>`);

  if (db.currentUser()) {
    box.append(el(`<button class="btn btn--sm" data-act="new-topic">Start a topic</button>`));
    box.querySelector('[data-act="new-topic"]').addEventListener("click", () => {
      const existing = box.querySelector(".topic-new");
      if (existing) return existing.remove();
      box.querySelector('[data-act="new-topic"]').after(newTopicForm());
    });
  } else {
    box.append(el(`<p class="hint">Sign in to start one or join in.</p>`));
  }

  const all = state.topics || [];
  if (!all.length) {
    box.append(el(`<div class="empty"><b>No topics yet</b>${
      db.currentUser() ? "Be the first. Anything you would have posted in the group belongs here."
        : "Sign in and start the first one."}</div>`));
    return box;
  }

  /* The filter only appears once there is enough to filter. */
  const live = TOPIC_CATS.filter((c) => all.some((t) => t.category === c.key));
  if (live.length > 1 && all.length > 4) {
    const chips = el(`<div class="cat-chips"></div>`);
    const draw = () => {
      chips.textContent = "";
      const mk = (key, label) => {
        const on = (state.topicCat || "") === key;
        const b = el(`<button class="chip${on ? " chip--on" : ""}">${esc(label)}</button>`);
        b.addEventListener("click", () => { state.topicCat = key; render(); });
        chips.append(b);
      };
      mk("", "All");
      live.forEach((c) => mk(c.key, c.label));
    };
    draw();
    box.append(chips);
  }

  const shown = state.topicCat ? all.filter((t) => t.category === state.topicCat) : all;
  if (!shown.length) {
    box.append(el(`<div class="empty"><b>Nothing under that heading yet</b>Try another, or start one.</div>`));
  }
  shown.forEach((t) => box.append(topicRow(t)));
  return box;
}

function topicRow(t) {
  const when = t.lastPostAt ? relTime(t.lastPostAt) : relTime(t.createdAt);
  const row = el(`
    <button class="club-row" data-topic="${esc(t.id)}">
      <span class="thread__tag thread__tag--topic">${esc(catLabel(t.category))}</span>
      <span style="flex:1;min-width:0">
        <span class="club-row__name">${t.pinned ? "\uD83D\uDCCC " : ""}${esc(t.title)}${
          t.locked ? " \uD83D\uDD12" : ""}</span>
        <span class="club-row__meta">${t.posts} post${t.posts === 1 ? "" : "s"}${
          t.lastAuthor ? ` &middot; last from ${esc(t.lastAuthor)}` : ""} &middot; ${esc(when)}</span>
      </span>
    </button>`);
  row.addEventListener("click", () => go("topic", { id: t.id }));
  return row;
}

function newTopicForm() {
  const form = el(`
    <div class="card topic-new">
      <label class="field">
        <span class="field__label">What is it about?</span>
        <select class="input" data-f="cat">
          ${TOPIC_CATS.map((c) => `<option value="${c.key}">${esc(c.label)} &mdash; ${esc(c.hint)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span class="field__label">Title</span>
        <input class="input" data-f="title" maxlength="90" placeholder="Say it in a few words">
      </label>
      <label class="field">
        <span class="field__label">First post</span>
        <textarea class="input" data-f="body" rows="4" maxlength="600"
          placeholder="What did you want to say?"></textarea>
      </label>
      <div class="row">
        <button class="btn" data-act="post">Start it</button>
        <span class="hint" data-role="say"></span>
      </div>
    </div>`);

  const say = form.querySelector('[data-role="say"]');
  form.querySelector('[data-act="post"]').addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const cat = form.querySelector('[data-f="cat"]').value;
    const title = form.querySelector('[data-f="title"]').value.trim();
    const body = form.querySelector('[data-f="body"]').value.trim();

    if (title.length < 4) { say.textContent = "Give it a title first."; return; }
    if (body.length < 1)  { say.textContent = "And something to start it off."; return; }

    /* The same check the wall itself runs, so a topic cannot be the way round
       the word filter. */
    const check = db.checkPost(`${title} ${body}`, { minLength: 5, maxLength: 690 });
    if (!check.ok) { say.textContent = check.reason; return; }
    const limit = db.rateLimit("topic", { max: 3, windowMs: 600000 });
    if (!limit.ok) { say.textContent = limit.reason; return; }

    btn.disabled = true; say.textContent = "Posting\u2026";
    try {
      const id = await db.startTopic(cat, title, body);
      state.topics = await db.topics();
      go("topic", { id });
    } catch (err) {
      btn.disabled = false;
      say.textContent = String(err?.message || err) || "That did not post.";
    }
  });
  return form;
}

function viewTopic({ id }) {
  const wrap = el(`<div></div>`);
  wrap.append(el(`<button class="back-link" data-nav="wall">\u2190 Fan Wall</button>`));

  const t = (state.topics || []).find((x) => String(x.id) === String(id));
  if (!t) {
    wrap.append(el(`<div class="empty"><b>That topic is not here</b>It may have been taken down, or the link may be old.</div>`));
    /* It may simply not have loaded yet on a cold open. */
    if (!state.topics) db.topics().then((rows) => { state.topics = rows; render(); }).catch(() => {});
    return wrap;
  }

  wrap.append(el(`
    <div class="page-head page-head--airy">
      <span class="thread__tag thread__tag--topic">${esc(catLabel(t.category))}</span>
      <h1>${esc(t.title)}</h1>
      <p>Started by ${esc(t.authorName)} &middot; ${esc(relTime(t.createdAt))}${
        t.locked ? " &middot; closed to new posts" : ""}</p>
    </div>`));

  if (db.isModerator()) {
    const bar = el(`<div class="row row--wrap mod-bar"></div>`);
    const btn = (field, on, label) => {
      const b = el(`<button class="link-btn">${esc(label)}</button>`);
      b.addEventListener("click", async () => {
        try {
          await db.setTopicState(t.id, field, on);
          state.topics = await db.topics();
          render();
        } catch (err) { toast(String(err?.message || err)); }
      });
      bar.append(b);
    };
    btn("pinned", !t.pinned, t.pinned ? "Unpin" : "Pin to the top");
    btn("locked", !t.locked, t.locked ? "Reopen" : "Close to new posts");
    btn("hidden", true, "Hide it");
    wrap.append(bar);
  }

  const key = `topic:${t.id}`;
  if (!t.locked || db.isModerator()) wrap.append(composer(key));

  const posts = db.list("wall")
    .filter((p) => p.thread === key && !p.replyTo)
    .filter((p) => !p.hidden || db.isModerator())
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (!posts.length) {
    wrap.append(el(`<div class="empty"><b>Nothing here yet</b>Say the first thing.</div>`));
  } else {
    posts.forEach((p) => wrap.append(wallCard(p, db.isModerator())));
  }
  return wrap;
}

function viewWall() {
  /* Refresh the topic list every time the wall is opened, so a topic somebody
     started on another device is there without a reload. */
  db.topics().then((rows) => {
    const same = JSON.stringify(rows) === JSON.stringify(state.topics);
    state.topics = rows;
    if (!same && state.view === "wall") render();
  }).catch(() => {});

  /* Two different rights wearing one name. Creating and approving polls is
     structural and stays with admins; hiding a post is moderation. */
  const admin = db.isAdmin();
  const mod = db.isModerator();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fan Wall</h1>
      <p>Open to every supporter. Keep it civil and it stays open.</p>
    </div>
  </div>`);

  const onAir = liveBanner();
  if (onAir) wrap.append(onAir);

  /* Anything answered since you last looked, before anything else. */
  wrap.append(replyInbox());

  /* Three different things used to run together down one column with nothing
     but a heading between them, so the wall itself read as an afterthought
     rather than the place to talk. Match threads and polls are now bounded
     panels you can skim past, and the feed below is plainly the feed. */

  const threads = openThreads();
  if (threads.length) {
    const box = el(`
      <section class="wall-block">
        <div class="wall-block__head">
          <h2>Match threads</h2>
          <span>Open from five days before a game to five days after</span>
        </div>
      </section>`);
    threads.forEach((t) => box.append(threadCard(t)));
    wrap.append(box);
  }

  /* Under the match threads, because the game is the one conversation that is
     guaranteed to happen every week. Everything else supporters bring
     themselves, and this is where it goes. */
  panelSection(wrap, null, () => topicList());

  const allPolls = db.list("poll");
  const polls = allPolls.filter((p) => (p.status || "live") === "live");
  const waiting = allPolls.filter((p) => p.status === "pending");

  /* Suggestions waiting on a volunteer. Only they see this. */
  if (admin && waiting.length) {
    const queue = el(`
      <section class="wall-block wall-block--queue">
        <div class="wall-block__head">
          <h2>Waiting for you</h2>
          <span>${waiting.length} poll${waiting.length === 1 ? "" : "s"} supporters have suggested</span>
        </div>
      </section>`);
    waiting.forEach((p) => {
      const card = el(`
        <div class="card suggestion">
          <div class="suggestion__who">${esc(p.authorName)} suggested</div>
          <div class="suggestion__q">${esc(p.question)}</div>
          <ul class="suggestion__opts">${p.options.map((o) => `<li>${esc(o.label)}</li>`).join("")}</ul>
          <div class="btn-row">
            <button class="btn btn--sm" data-ok>Put it up</button>
            <button class="btn btn--sm btn--ghost" data-no>Not this one</button>
          </div>
        </div>`);
      card.querySelector("[data-ok]").addEventListener("click", () => {
        db.setPollStatus(p.id, "live");
        toast("Poll is up.", "good");
      });
      card.querySelector("[data-no]").addEventListener("click", () => {
        db.setPollStatus(p.id, "rejected");
        toast("Turned down.");
      });
      queue.append(card);
    });
    wrap.append(queue);
  }

  if (polls.length || db.currentUser()) {
    const box = el(`
      <section class="wall-block">
        <div class="wall-block__head">
          <h2>Polls</h2>
          <span>${polls.length ? "Have your say" : "Nothing running just now"}</span>
        </div>
      </section>`);
    /* Anybody signed in can put one forward. A volunteer's goes straight up,
       everybody else's waits for one of them to look at it. */
    if (db.currentUser()) {
      const b = el(`<button class="btn btn--sm" style="margin-bottom:12px">${
        admin ? "Create a poll" : "Suggest a poll"
      }</button>`);
      b.addEventListener("click", pollForm);
      box.append(b);
    }
    polls.forEach((p) => box.append(pollCard(p)));
    if (polls.length || db.currentUser()) wrap.append(box);
  }

  /* ---- the feed ---- */
  const nudge = consentNudge();
  if (nudge) wrap.append(nudge);

  const posts = db.list("wall").filter((p) => !p.thread && !p.replyTo && (!p.hidden || mod));
  wrap.append(el(`
    <div class="feed-head">
      <h2>The wall</h2>
      <span>${posts.length ? `${posts.length} conversation${posts.length === 1 ? "" : "s"}` : "Anything not about one game"}</span>
    </div>`));
  wrap.append(composer(null));

  if (!posts.length) {
    wrap.append(el(`<div class="empty"><b>Nothing posted yet</b>Get the conversation going.</div>`));
  } else {
    const feed = el(`<div class="feed"></div>`);
    posts.forEach((p) => feed.append(wallCard(p, mod)));
    wrap.append(feed);
  }

  return wrap;
}

function wallCard(p, mod) {
  const liked = db.read(`like:${p.id}`, false);
  const card = el(`
    <div class="post" ${p.hidden ? 'style="opacity:.5"' : ""}>
      <div class="post__head">
        ${avatarHtml(p.authorName, p.authorId)}
        ${p.authorId
          ? `<button class="post__who post__who--link" data-supporter="${esc(String(p.authorId))}"
               >${esc(p.authorName)}</button>`
          : `<span class="post__who">${esc(p.authorName)}</span>`}
        ${db.isVolunteer(p.authorId) ? `<span class="pill pill--vol" title="Runs this site">Admin</span>` : ""}
        ${supporterTag(p.authorId)}
        ${p.hidden ? `<span class="pill pill--off">Hidden</span>` : ""}
        <span class="post__when">${esc(relTime(p.createdAt))}</span>
      </div>
      <div class="post__body">${esc(p.text)}</div>
      <div class="post__actions">
        <button class="link-btn" data-act="like">${liked ? "♥" : "♡"} ${p.likes || 0}</button>
        <button class="link-btn" data-act="report">Report</button>
        ${mod ? `<button class="link-btn" data-act="hide">${p.hidden ? "Unhide" : "Hide"}</button>` : ""}
        ${db.canEdit(p) ? `<button class="link-btn" data-act="del">Delete</button>` : ""}
        ${p.replyTo ? "" : `<button class="link-btn" data-act="reply">Reply</button>`}
      </div>
      ${p.replyTo ? "" : `<div class="replies"></div>`}
    </div>`);

  /* Replies hang off the post they answer, three deep. Deeper than that and a
     phone screen turns into a column of slivers, so the Reply button stops
     appearing and the database refuses it as well. */
  if (!p.replyTo) {
    const holder = card.querySelector(".replies");
    const kids = db.list("wall")
      .filter((r) => r.replyTo === p.id && (!r.hidden || mod))
      .sort((a, b) => a.createdAt - b.createdAt);
    kids.forEach((r) => holder.append(replyCard(r, mod, 1)));

    const replyBtn = card.querySelector('[data-act="reply"]');
    if (replyBtn) {
      replyBtn.addEventListener("click", () => {
        /* Signed out, the composer is a sign in notice with no textarea in it,
           so the focus has to be conditional or it throws on the click. */
        const focus = (node) => {
          const ta = node && node.querySelector("textarea");
          if (ta) ta.focus();
        };
        const existing = card.querySelector(".reply-box");
        if (existing) return focus(existing);
        const box = composer(p.thread || null, { replyTo: p.id, onDone: () => box.remove() });
        box.classList.add("reply-box");
        holder.append(box);
        focus(box);
      });
    }
  }

  /* The database owns the count now and hands back the new total, so two
     supporters liking at the same moment both register. The local note of what
     you have liked stays: it is what draws the heart filled in before the round
     trip finishes. */
  card.querySelector('[data-act="like"]').addEventListener("click", async () => {
    const now = !liked;
    db.write(`like:${p.id}`, now);
    db.patchLocal("wall", p.id, { likes: Math.max(0, (p.likes || 0) + (now ? 1 : -1)) });
    render();
    try {
      const total = await db.likePost(p.id, now);
      if (typeof total === "number") { db.patchLocal("wall", p.id, { likes: total }); render(); }
    } catch {
      /* Put the heart back rather than leave a like that did not happen. */
      db.write(`like:${p.id}`, !now);
      db.patchLocal("wall", p.id, { likes: Math.max(0, p.likes || 0) });
      toast("That like did not save. Try again in a moment.");
      render();
    }
  });
  card.querySelector('[data-act="report"]').addEventListener("click", () => {
    db.reportPost(p.id);
    toast("Reported. Thank you, one of the volunteers will take a look.");
  });
  card.querySelector('[data-act="hide"]')?.addEventListener("click", () => {
    db.update("wall", p.id, { hidden: !p.hidden });
    render();
  });
  card.querySelector('[data-act="del"]')?.addEventListener("click", () => {
    db.drop("wall", p.id);
    toast("Post deleted.");
    render();
  });
  return card;
}

function pollCard(p) {
  const mine = db.myVote(p.id);
  const total = p.options.reduce((n, o) => n + o.votes, 0);
  const card = el(`
    <div class="poll">
      <div class="poll__q">${esc(p.question)}</div>
      <div class="poll__opts"></div>
      <div class="hint">${total} vote${total === 1 ? "" : "s"}${mine !== null ? " · you have voted" : ""}</div>
    </div>`);

  const opts = card.querySelector(".poll__opts");
  p.options.forEach((o, i) => {
    const pct = total ? Math.round((o.votes / total) * 100) : 0;
    const btn = el(`
      <button class="poll__opt ${mine === i ? "is-mine" : ""}" ${mine !== null ? "disabled" : ""}>
        ${mine !== null ? `<span class="poll__fill" style="width:${pct}%"></span>` : ""}
        <span class="poll__row"><span>${esc(o.label)}</span>${
          mine !== null ? `<span class="poll__pct">${pct}%</span>` : ""
        }</span>
      </button>`);
    btn.addEventListener("click", () => {
      db.castVote(p.id, i);
      render();
    });
    opts.append(btn);
  });

  if (db.isAdmin()) {
    const actions = el(`<div class="post__actions"><button class="link-btn">Close poll</button></div>`);
    actions.querySelector("button").addEventListener("click", () => {
      db.drop("poll", p.id);
      toast("Poll closed.");
      render();
    });
    card.append(actions);
  }
  return card;
}

function pollForm() {
  const admin = db.isAdmin();
  const { node, close } = modal(`
    <h2>${admin ? "Create a poll" : "Suggest a poll"}</h2>
    <p class="sub">${admin
      ? "Two to four options works best."
      : "Two to four options works best. A volunteer will have a look before it goes up."}</p>
    <div class="field"><label for="pf-q">Question</label>
      <input id="pf-q" maxlength="120" placeholder="Who was your man of the match?"></div>
    ${[1, 2, 3, 4].map((n) => `
      <div class="field"><label for="pf-o${n}">Option ${n}${n > 2 ? " (optional)" : ""}</label>
        <input id="pf-o${n}" maxlength="60"></div>`).join("")}
    <div class="btn-row">
      <button class="btn btn--full" id="pf-save">${admin ? "Publish poll" : "Send it in"}</button>
      <button class="btn btn--ghost" id="pf-cancel">Cancel</button>
    </div>`);

  $("#pf-cancel", node).addEventListener("click", close);
  $("#pf-save", node).addEventListener("click", () => {
    const question = $("#pf-q", node).value.trim();
    if (question.length < 5) return toast("Give the poll a clearer question.");
    const options = [1, 2, 3, 4]
      .map((n) => $(`#pf-o${n}`, node).value.trim())
      .filter(Boolean)
      .map((label) => ({ label, votes: 0 }));
    if (options.length < 2) return toast("Add at least two options.");
    const limit = db.rateLimit("poll", { max: 3, windowMs: 600000 });
    if (!limit.ok) return toast(limit.reason, "bad");
    const check = db.checkPost(`${question} ${options.map((o) => o.label).join(" ")}`,
      { minLength: 5, maxLength: 400 });
    if (!check.ok) return toast(check.reason, "bad");

    db.add("poll", { question, options, status: admin ? "live" : "pending" });
    close();
    toast(admin ? "Poll published." : "Thanks, a volunteer will take a look.", "good");
    render();
  });
}

/* ================================================================ feedback */

const FEEDBACK_TOPICS = [
  ["works-well", "Something works well"],
  ["needs-work", "Something needs work"],
  ["idea", "An idea for the app"],
  ["problem", "Report a problem"],
  ["other", "Something else"],
];

function viewFeedback() {
  const user = db.currentUser();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Send Feedback</h1>
      <p>Tell the KTFCSA team what the app does well and what it does not. It goes
         straight to them, and nobody else sees it.</p>
    </div>
  </div>`);

  /* Feedback needs an account now. Anyone signed out used to get a form that
     looked fine and then failed at the database, so they are sent to the email
     address instead, which reaches the same place. */
  if (db.isOnline() && !user) {
    wrap.append(joinPrompt({
      heading: "Tell us what you think",
      blurb: "Feedback comes through an account so we know who to thank, and so nobody can send it in somebody else's name.",
      points: [
        "Goes straight to the volunteers, and nobody else sees it",
        "Tell us what works, what does not, or what is missing",
      ],
      footer: `Would rather not sign up? Email <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a> and it reaches the same people.`,
    }));
    return wrap;
  }

  const form = el(`
    <div class="card">
      <div class="field">
        <label for="fb-topic">What is this about</label>
        <select id="fb-topic">
          ${FEEDBACK_TOPICS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="fb-msg">Your feedback</label>
        <textarea id="fb-msg" maxlength="1000" rows="6"
          placeholder="The away guides are spot on. It would be good to see the coach pick-up on a map."></textarea>
        <div class="char-count" id="fb-count">0 / 1000</div>
      </div>
      <div class="field">
        <label for="fb-contact">How to reply${user ? " (optional)" : ""}</label>
        <input id="fb-contact" maxlength="80" placeholder="you@example.com"
               value="${user ? "" : ""}" autocomplete="email">
        <div class="hint">Leave this blank if you would rather not hear back.</div>
      </div>
      <button class="btn btn--full" id="fb-send">Send to the KTFCSA team</button>
    </div>`);

  const msg = $("#fb-msg", form);
  const count = $("#fb-count", form);
  msg.addEventListener("input", () => {
    count.textContent = `${msg.value.length} / 1000`;
    count.classList.toggle("is-over", msg.value.length > 1000);
  });

  $("#fb-send", form).addEventListener("click", async () => {
    const message = msg.value.trim();
    if (message.length < 4) return toast("Please write a little more.");

    const check = db.checkPost(message, { maxLength: 1000, minLength: 4 });
    if (!check.ok) return toast(check.reason, "bad");

    const limit = db.rateLimit("feedback", { max: 3, windowMs: 600000 });
    if (!limit.ok) return toast(limit.reason, "bad");

    const button = $("#fb-send", form);
    button.disabled = true;
    try {
      const { queued } = await db.sendFeedback({
        topic: $("#fb-topic", form).value,
        message,
        contact: $("#fb-contact", form).value.trim(),
      });
      msg.value = "";
      $("#fb-contact", form).value = "";
      count.textContent = "0 / 1000";
      toast(queued ? "Saved. It will send once the app is online." : "Thanks, that is with the KTFCSA team.");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });

  wrap.append(form);

  /* Volunteers read what has come in without leaving the app. */
  if (db.isAdmin()) {
    wrap.append(el(`<h2 class="section-title">What supporters have sent</h2>`));
    const box = el(`<div><div class="skeleton" style="height:90px"></div></div>`);
    db.feedbackList()
      .then((rows) => {
        box.innerHTML = "";
        if (!rows.length) {
          box.append(el(`<div class="empty"><b>Nothing yet</b>Feedback will appear here as it comes in.</div>`));
          return;
        }
        rows.forEach((r) => {
          const label = FEEDBACK_TOPICS.find(([v]) => v === r.topic)?.[1] || r.topic;
          const card = el(`
            <div class="post" ${r.handled ? 'style="opacity:.55"' : ""}>
              <div class="post__head">
                <span class="pill pill--${r.handled ? "muted" : "gold"}">${esc(label)}</span>
                ${r.handled ? `<span class="pill pill--muted">Handled</span>` : ""}
                <span class="post__when">${esc(relTime(new Date(r.created_at).getTime()))}</span>
              </div>
              <div class="post__body">${esc(r.message)}</div>
              <div class="post__meta">
                ${r.author_name ? `<span>From <b>${esc(r.author_name)}</b></span>` : `<span>Sent anonymously</span>`}
                ${r.contact ? `<span>Reply to <b>${esc(r.contact)}</b></span>` : ""}
              </div>
              <div class="post__actions">
                <button class="link-btn">${r.handled ? "Mark as not handled" : "Mark as handled"}</button>
              </div>
            </div>`);
          card.querySelector(".link-btn").addEventListener("click", () => {
            db.markFeedback(r.id, !r.handled);
            toast(r.handled ? "Reopened." : "Marked as handled.");
            render();
          });
          box.append(card);
        });
      })
      .catch(() => {
        box.innerHTML = "";
        box.append(el(`<div class="empty"><b>Could not load feedback</b>Please try again shortly.</div>`));
      });
    wrap.append(box);
  }

  return wrap;
}

/* ================================================================= account */

/** Choosing a new password, after a reset link or from the account page. */
function newPasswordPanel() {
  const box = el(`
    <div class="card">
      <div class="field">
        <label for="np1">New password</label>
        <input id="np1" type="password" autocomplete="new-password" minlength="8">
      </div>
      <div class="field">
        <label for="np2">Type it again</label>
        <input id="np2" type="password" autocomplete="new-password" minlength="8">
      </div>
      <div class="btn-row"><button class="btn btn--sm">Save the new password</button></div>
      <p class="hint">Eight characters or more. You stay signed in on this device.</p>
    </div>`);

  box.querySelector("button").addEventListener("click", () => {
    const a = box.querySelector("#np1").value;
    const b = box.querySelector("#np2").value;
    if (a.length < 8) return toast("Eight characters or more, please.", "bad");
    if (a !== b) return toast("Those two do not match.", "bad");
    /* withBusy has no catch of its own, so anything thrown in here becomes an
       unhandled rejection: the button springs back and the person is told
       nothing at all. Supabase refuses a password matching the old one, among
       other things, and that refusal was going straight to the floor. */
    withBusy(box.querySelector("button"), "Saving", async () => {
      try {
        await db.setPassword(a);
        state.recovering = false;
        toast("Password changed.", "good");
        render({ toTop: true });
      } catch (err) {
        toast(err.message || "That did not save.", "bad");
      }
    });
  });
  return box;
}

function viewAccount() {
  const user = db.currentUser();
  const online = db.isOnline();

  const wrap = el(`<div>
    <div class="page-head">
      <h1>Your account</h1>
      <p>${online
        ? "One account, on every device you use."
        : "Running on this device only. No account service is set up yet."}</p>
    </div>
  </div>`);

  /* Arrived from a reset link: the session is already live, so the only thing
     to do here is choose a new password. Put above everything, because that is
     the one job this visit has. */
  if (state.recovering) {
    wrap.append(el(`
      <div class="soon">
        <span class="soon__tag">Reset link opened</span>
        <p>You are signed in. Choose a new password and you are done.</p>
      </div>`));
    wrap.append(newPasswordPanel());
    return wrap;
  }

  if (!user) {
    wrap.append(online ? authPanel() : localSignInPanel());
    return wrap;
  }

  const idCard = el(`
    <div class="card">
      <div class="post__head" style="margin-bottom:12px">
        ${avatarHtml(user.name, user.id, "width:44px;height:44px;font-size:15px")}
        <div>
          <div class="post__who" style="font-size:1rem">${esc(user.name)}</div>
          <div class="hint" style="margin:0">${(() => {
            /* Was hardcoded to "Supporter" for everybody who is not an admin,
               so a tag a volunteer had handed out showed up on the fan wall and
               nowhere on the person's own account page. */
            const given = db.tagOf(user.id);
            if (user.isAdmin) return "KTFCSA volunteer";
            if (given) return esc(TAG_LABEL[given] || given);
            if (db.isContributor(user.id)) return "Contributor";
            return "Supporter";
          })()}</div>
        </div>
      </div>
      <div class="emblem-pick">
        <div class="emblem-pick__label">Your badge</div>
        <div class="emblem-pick__row"></div>
      </div>
      <div class="emblem-pick kit-pick">
        <div class="emblem-pick__label">Your kit</div>
        <div class="kit-pick__patterns"></div>
        <div class="kit-pick__colours"></div>
      </div>

      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" id="ac-rename">Change name</button>
        ${online ? `<button class="btn btn--ghost btn--sm" id="ac-pass">Change password</button>` : ""}
        <button class="btn btn--ghost btn--sm" id="ac-out">Sign out</button>
        ${!online && user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-lock">Turn off admin tools</button>` : ""}
        ${!online && !user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-admin">Volunteer sign in</button>` : ""}
      </div>
    </div>`);

  /* Changing it while signed in was not possible at all: the only route to a
     new password was the forgotten-password link, which is only on the signed
     out page and needs an email round trip to use. */
  const passBtn = $("#ac-pass", idCard);
  if (passBtn) {
    passBtn.addEventListener("click", () => {
      const holder = el(`<div style="margin-top:12px"></div>`);
      holder.append(newPasswordPanel());
      passBtn.replaceWith(holder);
    });
  }

  /* Badges are a fixed set, so picking one is a tap and nothing is uploaded.
     Tapping the one you already have puts you back to your initials. */
  /* As easy to withdraw as it was to give, which is the whole point. */
  const mail = el(`
    <div class="consent-row">
      <label class="consent">
        <input type="checkbox" id="ac-emails"${db.emailOptIn() ? " checked" : ""}>
        <span>
          <b>Emails about the app and the Association</b>
          News about the app and about forming the Supporters' Association. Never adverts, never
          passed to anybody else.
        </span>
      </label>
    </div>`);
  $("#ac-emails", mail).addEventListener("change", (e) => {
    db.setEmailOptIn(e.target.checked);
    toast(e.target.checked ? "We will keep you posted." : "No more emails.", "good");
  });
  idCard.append(mail);

  const row = $(".emblem-pick__row", idCard);
  const paintEmblems = () => {
    const mine = db.avatarOf(user.id);
    row.replaceChildren();
    Object.entries(EMBLEMS).forEach(([key, glyph]) => {
      if (ADMIN_ONLY_EMBLEMS.has(key) && !db.isAdmin()) return;
      const b = el(`
        <button class="emblem${mine === key ? " is-mine" : ""}" type="button"
          aria-pressed="${mine === key}" title="${esc(EMBLEM_LABEL[key] || key)}">${glyph}</button>`);
      b.addEventListener("click", () => {
        db.setAvatar(mine === key ? null : key);
        toast(mine === key ? "Back to your initials." : `Badge set to ${EMBLEM_LABEL[key] || key}.`);
      });
      row.append(b);
    });
  };
  paintEmblems();

  /* The kit behind the badge. Both were worked out from a hash of the name,
     which gave everybody something but let nobody change theirs. */
  const patRow = $(".kit-pick__patterns", idCard);
  const colRow = $(".kit-pick__colours", idCard);

  const paintKit = () => {
    const kit = db.kitOf(user.id);
    const pattern = db.patternOf(user.id) || patternFor(user.name);
    const shown = readableKit(kit || KIT_TONES[toneFor(user.name)]);

    patRow.replaceChildren();
    AVATAR_PATTERNS.forEach((key) => {
      const on = pattern === key;
      const b = el(`
        <button class="kit-swatch avatar avatar--${key}${on ? " is-mine" : ""}" type="button"
          aria-pressed="${on}" title="${esc(PATTERN_LABEL[key] || key)}"
          style="--kit-a:${shown};--kit-b:${partnerTone(shown)}"></button>`);
      b.addEventListener("click", () => {
        db.setAvatarStyle(kit, key);
        toast(`Kit set to ${(PATTERN_LABEL[key] || key).toLowerCase()}.`);
        paintKit();
      });
      patRow.append(b);
    });

    colRow.replaceChildren();
    KIT_TONES.forEach((hex) => {
      const on = (kit || "").toLowerCase() === hex.toLowerCase();
      const b = el(`
        <button class="kit-swatch kit-swatch--flat${on ? " is-mine" : ""}" type="button"
          aria-pressed="${on}" title="${esc(hex)}" style="background:${hex}"></button>`);
      b.addEventListener("click", () => {
        db.setAvatarStyle(hex, pattern);
        paintKit();
      });
      colRow.append(b);
    });

    /* Anything at all, for anybody the ten do not suit. The lettering flips to
       dark on a light colour, so a pale pick is still readable rather than
       being refused. */
    const any = el(`
      <label class="kit-any" title="Any colour you like">
        <input type="color" value="${esc(shown)}" aria-label="Any colour">
        <span>Any colour</span>
      </label>`);
    any.querySelector("input").addEventListener("change", (e) => {
      db.setAvatarStyle(e.target.value, pattern);
      paintKit();
    });
    colRow.append(any);

    if (kit || db.patternOf(user.id)) {
      const back = el(`<button class="link-btn kit-reset" type="button">Back to the one from my name</button>`);
      back.addEventListener("click", () => {
        db.setAvatarStyle(null, null);
        toast("Back to your original kit.");
        paintKit();
      });
      colRow.append(back);
    }
  };
  paintKit();

  wrap.append(idCard);

  $("#ac-rename", wrap).addEventListener("click", () => {
    const { node, close } = modal(`
      <h2>Change your name</h2>
      <p class="sub">This shows next to anything you post.</p>
      <div class="field"><label for="rn-name">Name</label>
        <input id="rn-name" maxlength="40" value="${esc(user.name)}"></div>
      <div class="btn-row">
        <button class="btn btn--full" id="rn-go">Save</button>
        <button class="btn btn--ghost" id="rn-cancel">Cancel</button>
      </div>`);
    $("#rn-cancel", node).addEventListener("click", close);
    $("#rn-go", node).addEventListener("click", async () => {
      try {
        await db.rename($("#rn-name", node).value);
        close();
        toast("Name updated.", "good");
        render();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  $("#ac-out", wrap).addEventListener("click", async () => {
    await db.signOut();
    toast("Signed out.", "good");
    render();
  });

  $("#ac-lock", wrap)?.addEventListener("click", () => {
    db.lockLocalAdmin();
    toast("Admin tools turned off.");
    render();
  });

  $("#ac-admin", wrap)?.addEventListener("click", () => {
    const { node, close } = modal(`
      <h2>Volunteer sign in</h2>
      <p class="sub">Unlocks coach notices, polls and moderation on this device.</p>
      <div class="field"><label for="ad-pass">Passcode</label>
        <input id="ad-pass" type="password" autocomplete="off"></div>
      <div class="btn-row">
        <button class="btn btn--full" id="ad-go">Unlock</button>
        <button class="btn btn--ghost" id="ad-cancel">Cancel</button>
      </div>`);
    $("#ad-cancel", node).addEventListener("click", close);
    const attempt = () => {
      try {
        db.unlockLocalAdmin($("#ad-pass", node).value);
        close();
        toast("Admin tools unlocked.");
        render();
      } catch (err) {
        toast(err.message);
      }
    };
    $("#ad-go", node).addEventListener("click", attempt);
    $("#ad-pass", node).addEventListener("keydown", (e) => e.key === "Enter" && attempt());
  });

  /* season snapshot */
  const s = db.attendanceSummary();
  if (online && s) {
    wrap.append(el(`<h2 class="section-title">Your season</h2>`));
    wrap.append(el(`
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Games</div><div class="info__value">${s.games}</div></div>
        <div class="info"><div class="info__label">Away</div><div class="info__value">${s.away_games}</div></div>
        <div class="info"><div class="info__label">Miles</div><div class="info__value" style="color:var(--accent)">${s.miles.toLocaleString("en-GB")}</div></div>
        <div class="info"><div class="info__label">See all</div><div class="info__value"><button class="link-btn" data-nav="season" style="font-size:0.8125rem;color:var(--accent)">My Season ›</button></div></div>
      </div>`));
  }

  /* Somebody given early sight of the consultation findings. Read-only, and it
     lives on their own account page rather than behind the admin panel, which
     they cannot open. */
  if (!user.isAdmin && db.canViewResults()) {
    wrap.append(el(`<h2 class="section-title">Consultation results</h2>`));
    const card = el(`
      <div class="card">
        <p class="club-overview">You have been given early sight of the fan consultation
        findings, before they go public at ${CLOSES_WORDS}. It is the same summary everybody
        sees afterwards: numbers, themes and the approved comments. Individual responses are not
        shown to anyone outside the volunteers running it.</p>
        <p class="hint" style="margin-top:10px">Please do not share the figures until they are
        published. They are still moving.</p>
      </div>`);
    const open = el(`<button class="btn btn--full" style="margin-top:12px">Open the results</button>`);
    open.addEventListener("click", () => { location.hash = "#/consult/preview"; });
    card.append(open);
    wrap.append(card);
  }

  if (user.isAdmin) {
    wrap.append(el(`<h2 class="section-title">Running the site</h2>`));
    const panel = el(`
      <div class="card">
        <p class="note" style="margin:0 0 12px">Activity across the site, and the people using it.</p>
        <button class="btn btn--full" data-nav="admin">Open the admin panel${pendingCount() ? `<span class="nav-badge">${pendingCount()}</span>` : ""}</button>
      </div>`);
    wrap.append(panel);
  }

  /* appearance */
  wrap.append(el(`<h2 class="section-title">Appearance</h2>`));
  const themeCard = el(`
    <div class="card">
      <label>Theme</label>
      <div class="segmented">
        ${[["dark", "Dark"], ["light", "Light"]]
          .map(([k, l]) => `<button data-theme-set="${k}" class="${currentTheme() === k ? "is-active" : ""}">${l}</button>`)
          .join("")}
      </div>
    </div>`);
  themeCard.querySelectorAll("[data-theme-set]").forEach((b) =>
    b.addEventListener("click", () => {
      setTheme(b.dataset.themeSet);
      render();
    })
  );
  wrap.append(themeCard);

  if (user.isAdmin) {
    wrap.append(el(`<h2 class="section-title">Admin</h2>`));
    const adminCard = el(`
      <div class="card">
        <div class="hint" style="margin-bottom:12px">
          Fixtures, results, cup draws and the table update themselves from the Southern
          League feed, so there is nothing to keep on top of there. The coach notice is
          the one thing that needs your attention each week.${
            online ? " Everything else can be edited in the Supabase dashboard." : ""
          }
        </div>
        <div class="btn-row">
          <button class="btn btn--sm btn--ghost" id="ad-refresh">Refresh league data</button>
          <button class="btn btn--sm btn--danger" id="ad-clear">Clear all posts</button>
        </div>
      </div>`);
    $("#ad-refresh", adminCard).addEventListener("click", async () => {
      toast("Refreshing…");
      await loadLeague(true);
      render();
      toast("League data refreshed.");
    });
    $("#ad-clear", adminCard).addEventListener("click", () => {
      const where = online ? "for everyone" : "saved on this device";
      if (!confirm(`Remove every coach notice, lift, poll and wall post ${where}?`)) return;
      db.clearAll();
      toast("Cleared.");
      render();
    });
    wrap.append(adminCard);
  }

  wrap.append(el(`<h2 class="section-title">About</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="hint" style="margin:0">
        Fixtures, results and the league table come from the Southern League, cup ties
        included. Ground, ticket and travel details come from the KTFCSA master
        spreadsheet. The Poppycast is a fan-led podcast and a partner of KTFCSA.
      </div>
    </div>`));

  return wrap;
}

/* ---- signing in with a real account ---- */

function authPanel() {
  const box = el(`
    <div class="card">
      <div class="segmented" style="margin-bottom:16px;width:100%">
        <button data-auth="in" class="is-active" style="flex:1">Sign in</button>
        <button data-auth="up" style="flex:1">Join</button>
      </div>
      <div id="auth-body"></div>
    </div>`);

  const paint = (which) => {
    box.querySelectorAll("[data-auth]").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.auth === which)
    );
    const body = $("#auth-body", box);
    body.innerHTML = "";

    if (which === "up") {
      body.append(el(`
        <div class="field"><label for="au-name">Your name</label>
          <input id="au-name" maxlength="40" placeholder="Dave from Desborough" autocomplete="name">
          <div class="hint">Shown next to your posts and in the prediction table.</div></div>
        <div class="field"><label for="au-email">Email address</label>
          <input id="au-email" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <div class="field"><label for="au-pass">Password</label>
          <input id="au-pass" type="password" autocomplete="new-password" placeholder="At least six characters"></div>

        <label class="consent">
          <input type="checkbox" id="au-emails">
          <span>
            <b>Keep me posted by email</b>
            News about the app and about forming the Supporters' Association. Never adverts, never
            passed to anybody else, and you can stop it any time from your account.
          </span>
        </label>
        <p class="hint" style="margin-top:10px">Creating an account means we hold your name and email
          address. <button class="link-btn" data-nav="privacy">What we do with it</button>.</p>`));
      const go = el(`<button class="btn btn--full">Create account</button>`);
      go.addEventListener("click", () =>
        withBusy(go, "Creating account", async () => {
          try {
            await db.signUp($("#au-email", box).value, $("#au-pass", box).value, $("#au-name", box).value,
              { emails: $("#au-emails", box).checked });
            toast("Welcome along.", "good");
            render();
          } catch (err) {
            toast(err.message, "bad");
          }
        })
      );
      body.append(go);
      return;
    }

    body.append(el(`
      <div class="field"><label for="ai-email">Email address</label>
        <input id="ai-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="ai-pass">Password</label>
        <input id="ai-pass" type="password" autocomplete="current-password"></div>`));
    const go = el(`<button class="btn btn--full">Sign in</button>`);
    const attempt = () =>
      withBusy(go, "Signing in", async () => {
        try {
          await db.signIn($("#ai-email", box).value, $("#ai-pass", box).value);
          toast("Signed in.", "good");
          render();
        } catch (err) {
          toast(err.message, "bad");
        }
      });
    go.addEventListener("click", attempt);
    $("#ai-pass", box).addEventListener("keydown", (e) => e.key === "Enter" && attempt());
    body.append(go);

    const forgot = el(`<div class="small-link" style="margin-top:12px">Forgotten your password?</div>`);
    forgot.addEventListener("click", async () => {
      const email = $("#ai-email", box).value.trim();
      if (!email) return toast("Enter your email address first, then tap again.");
      try {
        await db.resetPassword(email);
        toast("Check your inbox for a reset link.");
      } catch (err) {
        toast(err.message);
      }
    });
    body.append(forgot);
  };

  box.querySelectorAll("[data-auth]").forEach((b) =>
    b.addEventListener("click", () => paint(b.dataset.auth))
  );
  paint("in");
  return box;
}

function localSignInPanel() {
  const form = el(`
    <div class="card">
      <div class="field"><label for="ac-name">Your name</label>
        <input id="ac-name" placeholder="Dave from Desborough" maxlength="40" autocomplete="name">
        <div class="hint">Kept in this browser only. Predictions and attendance need the online setup.</div></div>
      <button class="btn btn--full" id="ac-in">Continue</button>
    </div>`);
  const go = async () => {
    try {
      await db.signUp("", "", $("#ac-name", form).value);
      toast("Welcome along.");
      render();
    } catch (err) {
      toast(err.message);
    }
  };
  $("#ac-in", form).addEventListener("click", go);
  $("#ac-name", form).addEventListener("keydown", (e) => e.key === "Enter" && go());
  return form;
}


/* =================================================================== theme */

const currentTheme = () => document.documentElement.dataset.theme || "dark";

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  db.write("theme", theme);
}

/* ==================================================================== data */

async function loadClubInfo() {
  const data = await readJSON("data/clubs.json");
  state.clubInfo = data?.clubs || {}; /* empty just means the club pages show less */
  const written = await readJSON("data/club-overviews.json");
  state.overviews = written?.clubs || {};
}

/* The squad as the club confirmed it. Names on a team sheet are matched back
   to this list by the fixture sync, so the app can trust the spellings. */
async function loadSquad() {
  state.squad = await readJSON("data/squad.json");
  const vids = await readJSON("data/videos.json");
  state.videos = vids?.videos || [];
  /* The channel the videos came from. Kept so the page can credit and link it
     rather than quietly presenting the club's work as the app's. */
  state.videoChannel = vids?.channel || null;
  state.facts = await readJSON("data/club-facts.json");
  state.bios = await readJSON("data/player-bios.json");
  /* null is fine: the ratings still work from team sheets alone */
}

/**
 * A JSON file from our own site, or null.
 *
 * A deploy in flight can answer 200 with an empty body, and the browser will
 * hold that for a minute. One retry past the cache turns a blank page into a
 * brief pause.
 */
/* ============================================================ poppies daily

   Five questions a day, the same five for everyone, from data/quiz-bank.json.
   Play without an account and the days live on the device; sign in and they
   follow you and reach the leaderboard.

   The bank is around 30KB gzipped, so it is fetched the first time somebody
   opens the game and never on the fixtures page. The archive is a separate
   load for the same reason.                                                */

/** Fetches the question bank once, and remembers the promise, not the result. */
function ensureQuiz() {
  if (!state.quizPromise) {
    state.quizPromise = readJSON("data/quiz-bank.json").then((bank) => {
      if (bank) {
        state.quiz = bank;
        state.quizById = Object.fromEntries((bank.questions || []).map((q) => [q.id, q]));
      }
      return bank;
    });
  }
  return state.quizPromise;
}

/** The archive of past matches, for On This Day and the player pages. */
function ensureArchive() {
  if (!state.archivePromise) {
    state.archivePromise = readJSON("data/archive.json").then((a) => {
      if (a) {
        state.archive = a;
        state.archiveIndex = buildArchiveIndex(a);
      }
      return a;
    });
  }
  return state.archivePromise;
}

/**
 * The rest of a career, from the same team sheets.
 *
 * Appearances and a list of seasons is a record of turning up. What a
 * supporter wants to know is whether the side won when they played, whether
 * they were a cup player or a league one, the biggest crowd they stood in
 * front of, and who they lined up beside week after week. None of that needed
 * fetching: it was in the rows already.
 */
function careerDetail(r) {
  const box = el(`<div></div>`);
  const played = r.won + r.drew + r.lost;

  /* The league records no position on any team sheet it has ever published, so
     this is only known for the current squad, from the club's own list. Shown
     where we have it rather than left off everywhere for consistency's sake. */
  const squad = (state.squad?.players || []).find((x) => x.name === r.name);
  if (squad?.position) {
    box.append(el(`<h2 class="section-title">Position</h2>`));
    box.append(el(`<div class="card"><div class="info__value">${esc(squad.position)}</div>
      <p class="hint">From the club's squad list for this season.</p></div>`));
  }

  box.append(el(`<h2 class="section-title">Their record</h2>`));

  const card = el(`<div class="card"></div>`);
  if (played) {
    const pct = Math.round((r.won / played) * 100);
    card.append(el(`
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Won</div>
          <div class="info__value" style="color:var(--accent)">${r.won}</div></div>
        <div class="info"><div class="info__label">Drawn</div><div class="info__value">${r.drew}</div></div>
        <div class="info"><div class="info__label">Lost</div><div class="info__value">${r.lost}</div></div>
        <div class="info"><div class="info__label">Win rate</div><div class="info__value">${pct}%</div></div>
      </div>`));
    card.append(el(`<p class="hint">Across ${played} game${played === 1 ? "" : "s"} with a
      result recorded.</p>`));
  }

  const facts = [];
  if (r.captain) {
    facts.push(`Captained the side <b>${r.captain} time${r.captain === 1 ? "" : "s"}</b>`);
  }
  if (r.league || r.cup) {
    facts.push(`${r.league} league game${r.league === 1 ? "" : "s"}${
      r.cup ? ` and ${r.cup} in cup competitions` : ""}`);
  }
  if (r.home || r.away) facts.push(`${r.home} at Latimer Park, ${r.away} on the road`);
  if (r.goals) facts.push(`<b>${r.goals} goal${r.goals === 1 ? "" : "s"}</b> this season`);
  if (r.bestCrowd) {
    facts.push(`Biggest crowd they played in front of: <b>${
      r.bestCrowd.toLocaleString("en-GB")}</b> ${esc(r.bestCrowdWhere || "")}`);
  }
  if (r.mostWith && r.mostWithGames > 3) {
    facts.push(`Lined up alongside <b>${esc(r.mostWith)}</b> more than anybody else, ${
      r.mostWithGames} times`);
  }
  if (r.firstOpp) facts.push(`First seen against ${esc(r.firstOpp)}`);
  if (r.lastOpp && r.last !== r.first) facts.push(`Last against ${esc(r.lastOpp)}`);

  if (facts.length) {
    const list = el(`<ul class="career"></ul>`);
    facts.forEach((f) => list.append(el(`<li>${f}</li>`)));
    card.append(list);
  }

  card.append(el(`<p class="note">Worked out from the league's team sheets. It names no
    goalscorer before this season and records no positions or assists at all, so those are
    missing rather than nought.</p>`));

  box.append(card);
  return box;
}

/** Everyone who has played since 2018, reduced once rather than per render. */
function buildArchiveIndex(a) {
  const out = new Map();

  /* Everything below is worked out from team sheets we already hold, not
     fetched. Appearances and a list of seasons was thin, and the rest of it was
     sitting in the same rows the whole time: who won, who they played, what the
     crowd was, who they lined up beside.
  
     What is genuinely not available, having gone looking: position and country
     are null on every one of the 3,975 lineup entries the league has ever
     published for us, there is no player endpoint to ask, and scorers read
     "N/A" for every season before 2026/27. Assists are recorded nowhere. So
     goals are this season only and there are no positions for players who have
     left. Better a gap than a guess. */
  const add = (name, season, shirt, date, ctx) => {
    if (!name) return;
    if (!out.has(name)) {
      out.set(name, {
        name, apps: 0, seasons: new Set(), shirts: new Set(), first: date, last: date,
        firstOpp: ctx?.opponent || null, lastOpp: ctx?.opponent || null,
        won: 0, drew: 0, lost: 0,
        home: 0, away: 0,
        league: 0, cup: 0,
        goals: 0,
        bestCrowd: 0, bestCrowdWhere: null,
        captain: 0,
        withPlayers: new Map(),
      });
    }
    const r = out.get(name);
    r.apps += 1;
    r.seasons.add(season);
    if (shirt != null) r.shirts.add(shirt);
    /* <= and >= rather than < and >, because the first row through here already
       set first and last to its own date: a strict comparison then never fired
       and the opponent stayed null for anybody whose debut was their earliest
       row, which is everybody. */
    if (date <= r.first) { r.first = date; r.firstOpp = ctx?.opponent || r.firstOpp; }
    if (date >= r.last) { r.last = date; r.lastOpp = ctx?.opponent || r.lastOpp; }
    if (!ctx) return;

    if (ctx.result === "W") r.won += 1;
    else if (ctx.result === "D") r.drew += 1;
    else if (ctx.result === "L") r.lost += 1;

    if (ctx.venue === "Home") r.home += 1; else if (ctx.venue === "Away") r.away += 1;
    if (ctx.cup) r.cup += 1; else r.league += 1;

    if (ctx.captain) r.captain += 1;

    if (ctx.att && ctx.att > r.bestCrowd) {
      r.bestCrowd = ctx.att;
      r.bestCrowdWhere = `${ctx.venue === "Home" ? "v" : "at"} ${ctx.opponent}, ${
        String(ctx.season || "").trim()}`;
    }
    (ctx.mates || []).forEach((other) => {
      if (other === name) return;
      r.withPlayers.set(other, (r.withPlayers.get(other) || 0) + 1);
    });
  };

  /* Same list the attendance work uses, and for the same reason: a cup tie is
     not a league game and a player's record should say which. */
  const isCup = (c) => /cup|trophy|play-?offs?|vase/i.test(c || "");

  const resultOf = (us, them) => {
    const a1 = Number(us), b1 = Number(them);
    if (!Number.isFinite(a1) || !Number.isFinite(b1)) return null;
    return a1 > b1 ? "W" : a1 === b1 ? "D" : "L";
  };

  for (const m of a.matches) {
    const names = m.lineup.map(([pi]) => a.players[pi]).filter(Boolean);
    const ctx = {
      opponent: m.opponent,
      venue: m.venue,
      season: m.season,
      att: Number(m.att) || 0,
      cup: isCup(m.competition),
      result: resultOf(m.us, m.them),
      mates: names,
    };
    for (const row of m.lineup) {
      const [pi, shirt, cap] = row;
      add(a.players[pi], m.season, shirt, m.date, { ...ctx, captain: Boolean(cap) });
    }
  }

  /* The archive stops where the current season starts, which is right for the
     file and wrong for a player's record: it meant this season's appearances
     counted nowhere, so anybody playing now looked like they had stopped.
     league.json has the same team sheets in a different shape, so the current
     season is folded in here rather than duplicated on disk. */
  const league = state.league;
  if (league?.fixtures?.length) {
    for (const f of league.fixtures) {
      if (!Array.isArray(f.lineup) || !f.lineup.length) continue;
      const names = f.lineup.map((p) => p.name).filter(Boolean);
      const home = f.venue === "Home";
      const us = home ? f.homeScore : f.awayScore;
      const them = home ? f.awayScore : f.homeScore;
      const ctx = {
        opponent: clubName(f.opponent),
        venue: f.venue,
        season: league.season,
        att: 0,
        cup: isCup(f.competition),
        result: f.status === "played" ? resultOf(us, them) : null,
        mates: names,
      };
      for (const p of f.lineup) {
        add(p.name, league.season, p.number ?? null, f.date, { ...ctx, captain: Boolean(p.captain) });
      }

      /* Goals, this season only. Every season before it has the scorer down as
         "N/A" in the feed, so there is nothing to count. */
      (f.events?.goals || []).forEach((g) => {
        if (!g.ours || !g.name) return;
        const r = out.get(g.name);
        if (r) r.goals += 1;
      });
    }
  }

  /* Who they played alongside most, resolved once rather than on every render. */
  out.forEach((r) => {
    let best = null, n = 0;
    r.withPlayers.forEach((count, other) => { if (count > n) { n = count; best = other; } });
    r.mostWith = best;
    r.mostWithGames = n;
    delete r.withPlayers;
  });

  return out;
}

/* ==================================================== who played more? */

/**
 * A second game, deliberately unlike the first.
 *
 * Poppies Daily is five questions once a day and then it is gone. This is the
 * opposite: endless, quick, and about the players rather than the trivia. Two
 * names, pick whichever made more appearances, keep going until you are wrong.
 *
 * Built entirely from the archive already loaded for On This Day and the
 * player pages, so it costs one file that was being fetched anyway.
 */
const DUEL_MIN_APPS = 5;

function duelPool() {
  if (!state.archiveIndex) return [];
  return [...state.archiveIndex.values()]
    .filter((p) => p.apps >= DUEL_MIN_APPS)
    .map((p) => ({ name: p.name, apps: p.apps, seasons: p.seasons.size,
                   first: p.first, last: p.last }));
}

/** Two players with different totals, so there is always a right answer. */
function duelPair(pool) {
  for (let tries = 0; tries < 40; tries += 1) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    const b = pool[Math.floor(Math.random() * pool.length)];
    if (a && b && a.name !== b.name && a.apps !== b.apps) return [a, b];
  }
  return null;
}

/** The best runs anybody has managed. */
function duelBoard() {
  const box = el(`<div></div>`);
  db.duelLeague().then((rows) => {
    if (!rows.length) return;
    const me = db.currentUser()?.id;
    box.append(el(`<h2 class="section-title">Longest runs</h2>`));
    const card = el(`<div class="card ladder"></div>`);
    rows.slice(0, 10).forEach((r, i) => {
      card.append(el(`
        <div class="ladder__row${r.profile_id === me ? " ladder__row--me" : ""}">
          <span class="ladder__pos">${i + 1}</span>
          <span class="ladder__who">${namePlusTag(r.profile_id, r.display_name)}</span>
          <span class="ladder__meta">${r.plays} game${r.plays === 1 ? "" : "s"}</span>
          <span class="ladder__pts">${r.best}</span>
        </div>`));
    });
    card.append(el(`<p class="hint">${db.currentUser()
      ? "Your best is saved when a run ends."
      : "Sign in and your best run gets on the board. Playing works either way."}</p>`));
    box.append(card);
  }).catch(() => { /* the game works without a board */ });
  return box;
}

function viewDuel() {
  const wrap = el(`
    <div>
      <div class="page-head page-head--airy">
        <h1>Who played more?</h1>
        <p>Two Poppies, one question. Pick whoever made more appearances since 2018, and keep
           going until you get one wrong.</p>
      </div>
      <div class="duel-slot"></div>
    </div>`);

  const slot = $(".duel-slot", wrap);
  slot.append(el(`<div class="card"><p class="note" style="margin:0">Loading the archive.</p></div>`));

  ensureArchive().then(() => {
    const pool = duelPool();
    if (pool.length < 4) {
      slot.replaceChildren();
      slot.append(el(`<div class="empty"><b>Not enough in the archive yet</b>This needs a few more
        seasons of team sheets before it can ask anything sensible.</div>`));
      return;
    }

    let streak = 0;
    let best = db.read("duel-best", 0);
    let pair = duelPair(pool);
    let answered = false;

    const draw = () => {
      slot.replaceChildren();
      if (!pair) {
        slot.append(el(`<div class="empty"><b>Ran out of players</b>Try again in a moment.</div>`));
        return;
      }

      const score = el(`
        <div class="duel-score">
          <span><b>${streak}</b> in a row</span>
          <span class="duel-score__best">Best ${best}</span>
        </div>`);
      /* Repainted the moment an answer lands. Leaving it until the next pair
         meant the score always read one behind, which looks like a bug. */
      const paintScore = () => {
        score.replaceChildren(
          el(`<span><b>${streak}</b> in a row</span>`),
          el(`<span class="duel-score__best">Best ${best}</span>`));
      };
      slot.append(score);

      const board = el(`<div class="duel"></div>`);
      pair.forEach((p, i) => {
        const card = el(`
          <button class="duel__side" data-side="${i}">
            <span class="duel__name">${esc(p.name)}</span>
            <span class="duel__meta">${p.seasons} season${p.seasons === 1 ? "" : "s"}</span>
            <span class="duel__apps" hidden>${p.apps}<span>apps</span></span>
          </button>`);
        board.append(card);
      });
      board.append(el(`<span class="duel__v" aria-hidden="true">or</span>`));
      slot.append(board);

      const feedback = el(`<div class="duel-feedback"></div>`);
      slot.append(feedback);

      board.querySelectorAll("[data-side]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (answered) return;
          answered = true;
          const picked = pair[Number(btn.dataset.side)];
          const other = pair[1 - Number(btn.dataset.side)];
          const right = picked.apps > other.apps;

          board.querySelectorAll(".duel__apps").forEach((n) => { n.hidden = false; });
          board.querySelectorAll("[data-side]").forEach((b, i) => {
            b.classList.add(pair[i].apps > pair[1 - i].apps ? "duel__side--more" : "duel__side--less");
          });

          if (right) {
            streak += 1;
            if (streak > best) { best = streak; db.write("duel-best", best); }
            paintScore();
            feedback.append(el(`<p class="duel-feedback__ok">Correct. ${esc(picked.name)} made
              ${picked.apps} to ${other.apps}.</p>`));
          } else {
            /* Recorded when the run ends rather than on every answer: one write
               per game instead of one per tap. */
            db.recordDuel(streak);
            streak = 0;
            paintScore();
            feedback.append(el(`<p class="duel-feedback__no">Not this time. ${esc(other.name)} made
              ${other.apps} to ${picked.apps}.</p>`));
          }

          const next = el(`<button class="btn btn--sm">${right ? "Next pair" : "Start again"}</button>`);
          next.addEventListener("click", () => {
            answered = false;
            pair = duelPair(pool);
            draw();
          });
          feedback.append(next);
        });
      });
    };

    draw();
    wrap.append(duelBoard());
    slot.append(el(`<p class="note" style="margin-top:14px">Appearances are counted from league
      team sheets held in the player archive, which begins in 2018/19. Anybody who played before
      that, or who only ever came off the bench without being listed, will be short.</p>`));
  }).catch(() => {
    slot.replaceChildren();
    slot.append(el(`<div class="empty"><b>The archive did not load</b>Try again shortly.</div>`));
  });

  return wrap;
}

/** The five for today, or null when the game has not started or has run out. */
const todaysQuiz = () => {
  const ids = state.quiz?.schedule?.[londonToday()];
  if (!ids) return null;
  const qs = ids.map((id) => state.quizById?.[id]).filter(Boolean);
  return qs.length === ids.length ? qs : null;
};

const quizGrid = (marks) => [...marks].map((m) => (m === "1" ? "🟩" : "⬜")).join("");

/** What gets pasted into the Facebook group. Spoiler-free, so no questions. */
function shareText(date, marks) {
  const streak = db.quizStreak(date);
  const score = [...marks].filter((m) => m === "1").length;
  return [
    `Poppies Daily #${dayNumber(date)}  ${score}/5`,
    quizGrid(marks),
    streak > 1 ? `🔥 ${streak} day streak` : "",
    "fans.ktfcsa.com",
  ].filter(Boolean).join("\n");
}

/**
 * Three goes at the clipboard, in order of how modern they are. All of it runs
 * inside the click handler so the user gesture is still live, which the first
 * one insists on.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused, or an older iOS that has the object but not the permission */
  }
  try {
    /* Still the only thing that works in some in-app browsers, which is exactly
       where a link from the Facebook group lands people. */
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.append(box);
    box.select();
    box.setSelectionRange(0, text.length); /* iOS ignores select() on its own */
    const ok = document.execCommand("copy");
    box.remove();
    if (ok) return true;
  } catch {
    /* fall through and show it instead */
  }
  return false;
}

function shareResult(date, marks) {
  const text = shareText(date, marks);
  copyText(text).then((ok) => {
    if (ok) return toast("Copied. Paste it into the group.");
    /* Never claim it copied when it did not - show it so they can take it.
       modal() takes an HTML string and ignores anything after it, so passing a
       title and a node meant the dialog opened saying "Your result" with
       nothing in it to copy: the one job the fallback had. */
    modal(`
      <h3 style="margin:0 0 8px">Your result</h3>
      <p class="hint" style="margin-bottom:10px">Press and hold to copy.</p>
      <textarea readonly rows="5" style="width:100%">${esc(text)}</textarea>`);
  });
}

/**
 * Supporters who called the last score exactly, on the home page for two days.
 *
 * The prediction league already counts these, but a number in a column three
 * taps away is not the same as your name on the front page the morning after.
 * It is a shout rather than a monument, so it goes when the game does: the
 * window lives in the view, counted from kick-off, so a result typed in late
 * does not hand anybody a fresh two days.
 */
function exactCallout() {
  const box = el(`<div></div>`);
  db.exactCalls().then((rows) => {
    if (!rows.length) return;

    /* One game at a time. If two have been played inside the window, the
       newest is the one people are still talking about. */
    const newest = rows[0].fixture_id;
    const called = rows.filter((r) => r.fixture_id === newest);
    const g = called[0];

    const home = g.venue === "Home";
    const score = home
      ? `${g.home_score}-${g.away_score}`
      : `${g.away_score}-${g.home_score}`;
    const line = home
      ? `Kettering ${g.home_score}-${g.away_score} ${clubName(g.opponent)}`
      : `${clubName(g.opponent)} ${g.home_score}-${g.away_score} Kettering`;

    const names = called.map((r) => r.display_name);
    const who = names.length === 1
      ? `<b>${esc(names[0])}</b>`
      : names.length === 2
        ? `<b>${esc(names[0])}</b> and <b>${esc(names[1])}</b>`
        : `${names.slice(0, -1).map((n) => `<b>${esc(n)}</b>`).join(", ")} and <b>${
            esc(names[names.length - 1])}</b>`;

    const card = el(`
      <div class="called">
        <div class="called__score">${esc(score)}</div>
        <div class="called__body">
          <div class="called__label">Called it exactly</div>
          <p>${who} ${names.length === 1 ? "predicted" : "predicted"} ${esc(line)} on the nose.</p>
        </div>
      </div>`);

    /* Their names open their cards, the same as everywhere else names appear. */
    called.forEach((r, i) => {
      const b = card.querySelectorAll(".called__body b")[i];
      if (b) { b.dataset.supporter = String(r.profile_id); b.classList.add("called__who"); }
    });

    box.append(card);
  }).catch((err) => { console.warn("Exact calls did not load:", err); });
  return box;
}

/* --------------------------------------------------------- Poppies Wordle */

const WORDLE_TRIES = 6;

/** The day's word. Same for everybody, and no repeat until the list is done. */
function wordleFor(iso) {
  const bank = state.wordleBank?.words;
  if (!bank?.length) return null;
  const n = dayNumber(iso);
  return bank[((n - 1) % bank.length + bank.length) % bank.length];
}

/**
 * Mark a guess against the answer.
 *
 * Two passes, which is the bit everybody gets wrong first time: exact matches
 * are taken out before the misplaced ones are counted, or a word with two of a
 * letter marks both amber when only one belongs.
 */
function markGuess(guess, answer) {
  const g = guess.toUpperCase().split("");
  const a = answer.toUpperCase().split("");
  const out = new Array(g.length).fill(0);
  const left = {};

  g.forEach((ch, i) => {
    if (ch === a[i]) out[i] = 2;
    else left[a[i]] = (left[a[i]] || 0) + 1;
  });
  g.forEach((ch, i) => {
    if (out[i] === 2) return;
    if (left[ch] > 0) { out[i] = 1; left[ch] -= 1; }
  });
  return out.join("");
}

const wordleKey = (iso) => `wordle:${iso}`;

function wordleState(iso) {
  const saved = db.read(wordleKey(iso), null);
  if (saved && Array.isArray(saved.guesses)) return saved;
  return { guesses: [], done: false, solved: false };
}

function viewWordle() {
  const wrap = el(`
    <div>
      <div class="page-head">
        <h1>Poppies Wordle</h1>
        <p>One word a day about Kettering Town, the same word for everybody. The
           length changes, so count the boxes before you start.</p>
      </div>
    </div>`);

  const tabs = [["play", "Today"], ["board", "Leaderboard"]];
  const tab = state.wordleTab || "play";
  const bar = el(`
    <div class="segmented" style="margin-bottom:16px" role="group" aria-label="Poppies Wordle">
      ${tabs.map(([k, l]) => `<button data-wtab="${k}" class="${tab === k ? "is-active" : ""}">${l}</button>`).join("")}
    </div>`);
  bar.querySelectorAll("[data-wtab]").forEach((b) =>
    b.addEventListener("click", () => { state.wordleTab = b.dataset.wtab; render(); }));
  wrap.append(bar);

  if (tab === "board") { wrap.append(wordleBoard()); return wrap; }

  if (!state.wordleBank) {
    wrap.append(el(`<div class="card"><p class="hint">Loading today's word&hellip;</p></div>`));
    if (state.wordleBank === null) {
      state.wordleBank = undefined;
      readJSON("data/wordle-bank.json").then((r) => { state.wordleBank = r || false; render(); });
    }
    return wrap;
  }

  const iso = londonToday();
  const entry = wordleFor(iso);
  if (!entry) {
    wrap.append(el(`<div class="empty"><b>No word today</b>Something went wrong loading it.</div>`));
    return wrap;
  }

  const answer = entry.word;
  const st = wordleState(iso);
  const rows = [];

  const grid = el(`<div class="wgrid" style="--wlen:${answer.length}"></div>`);
  const drawGrid = () => {
    grid.textContent = "";
    for (let r = 0; r < WORDLE_TRIES; r++) {
      const guess = st.guesses[r];
      for (let c = 0; c < answer.length; c++) {
        const ch = guess ? guess[c] : "";
        const mark = guess ? markGuess(guess, answer)[c] : "";
        grid.append(el(`<div class="wcell${
          mark === "2" ? " wcell--right" : mark === "1" ? " wcell--near" : guess ? " wcell--no" : ""
        }">${esc(ch)}</div>`));
      }
    }
  };
  drawGrid();

  const card = el(`<div class="card"></div>`);
  card.append(el(`<div class="info__label">${answer.length} letters &middot; ${
    WORDLE_TRIES - st.guesses.length} ${st.guesses.length === WORDLE_TRIES - 1 ? "go" : "goes"} left</div>`));
  card.append(grid);

  /* The clue is not there to be read first. It appears once somebody is two
     wrong, which is the point at which a cryptic word stops being fun. */
  if (entry.clue && st.guesses.length >= 2 && !st.done) {
    card.append(el(`<p class="hint wclue">Clue: ${esc(entry.clue)}</p>`));
  }

  const say = el(`<p class="hint" data-role="say"></p>`);

  if (!st.done) {
    const inputRow = el(`
      <div class="row" style="margin-top:10px">
        <input class="input winput" maxlength="${answer.length}" autocapitalize="characters"
          autocomplete="off" spellcheck="false" placeholder="${answer.length} letters">
        <button class="btn" data-act="guess">Guess</button>
      </div>`);
    const box = inputRow.querySelector(".winput");
    const submit = () => {
      const g = box.value.toUpperCase().replace(/[^A-Z]/g, "");
      if (g.length !== answer.length) {
        say.textContent = `It is ${answer.length} letters.`;
        return;
      }
      st.guesses.push(g);
      st.solved = g === answer;
      st.done = st.solved || st.guesses.length >= WORDLE_TRIES;
      db.write(wordleKey(iso), st);

      if (st.done) {
        const marks = st.guesses.map((x) => markGuess(x, answer)).join("");
        db.recordWordle(iso, answer.length, st.guesses.length, st.solved, marks);
      }
      render();
    };
    inputRow.querySelector('[data-act="guess"]').addEventListener("click", submit);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    card.append(inputRow);
    card.append(say);
    setTimeout(() => box.focus(), 0);
  } else {
    card.append(el(`<p class="wdone">${
      st.solved
        ? `Got it in ${st.guesses.length}. ${esc(answer)}.`
        : `Not today. It was <b>${esc(answer)}</b>.`}</p>`));
    if (entry.clue) card.append(el(`<p class="hint">${esc(entry.clue)}</p>`));
    const share = el(`<button class="btn btn--sm">Share your grid</button>`);
    share.addEventListener("click", () => shareWordle(iso, st, answer));
    card.append(share);
    if (!db.currentUser()) {
      card.append(el(`<p class="hint">Sign in and your streak counts on the board.</p>`));
    }
  }

  wrap.append(card);
  return wrap;
}

/** The grid as squares, which is the bit people paste into the group. */
function shareWordle(iso, st, answer) {
  const n = dayNumber(iso);
  const rows = st.guesses.map((g) =>
    markGuess(g, answer).split("").map((m) =>
      (m === "2" ? "\uD83D\uDFE8" : m === "1" ? "\uD83D\uDFE7" : "\u2B1B")).join(""));
  const head = `Poppies Wordle #${n} \u2014 ${st.solved ? st.guesses.length : "X"}/${WORDLE_TRIES} (${answer.length} letters)`;
  const text = `${head}\n${rows.join("\n")}\nfans.ktfcsa.com`;
  copyText(text).then((ok) => {
    if (ok) return toast("Copied. Paste it into the group.");
    modal(`
      <h3 style="margin:0 0 8px">Your grid</h3>
      <p class="hint" style="margin-bottom:10px">Press and hold to copy.</p>
      <textarea readonly rows="8" style="width:100%">${esc(text)}</textarea>`);
  });
}

function wordleBoard() {
  const card = el(`<div class="card"><p class="hint">Longest run of days solved. A missed day ends it.</p></div>`);
  const body = el(`<div class="stand"></div>`);
  card.append(body);
  db.wordleLeague().then((rows) => {
    body.textContent = "";
    const live = (rows || []).filter((r) => Number(r.streak) > 0).slice(0, 20);
    if (!live.length) { body.append(el(`<p class="hint">Nobody has a streak going yet.</p>`)); return; }
    live.forEach((r, i) => body.append(el(`
      <div class="stand__row">
        <span class="stand__rank${i === 0 ? " stand__rank--1" : ""}">${i + 1}</span>
        <button class="stand__who" data-supporter="${esc(String(r.profile_id))}">${esc(r.display_name)}</button>
        <span class="stand__n">${esc(String(r.streak))}</span>
      </div>`)));
  }).catch(() => { body.textContent = ""; body.append(el(`<p class="hint">That did not load.</p>`)); });
  return card;
}

function viewDaily() {
  const wrap = el(`
    <div>
      <div class="page-head">
        <h1>Poppies Daily</h1>
        <p>Five questions about Kettering Town, the same five for everybody. Back tomorrow.</p>
      </div>
    </div>`);

  const tabs = [["play", "Today"], ["board", "Leaderboard"]];
  const tab = state.dailyTab || "play";
  const bar = el(`
    <div class="segmented" style="margin-bottom:16px" role="group" aria-label="Poppies Daily">
      ${tabs.map(([k, l]) => `<button data-dtab="${k}" class="${tab === k ? "is-active" : ""}">${l}</button>`).join("")}
    </div>`);
  bar.querySelectorAll("[data-dtab]").forEach((b) =>
    b.addEventListener("click", () => { state.dailyTab = b.dataset.dtab; render(); }));
  wrap.append(bar);

  if (tab === "board") {
    wrap.append(quizBoard());
    return wrap;
  }

  const box = el(`<div><div class="skeleton" style="height:260px"></div></div>`);
  wrap.append(box);
  ensureQuiz().then(() => {
    box.innerHTML = "";
    box.append(quizBody());
  }).catch(() => {
    box.innerHTML = "";
    box.append(el(`<div class="empty">Today's questions could not be loaded. Try again in a moment.</div>`));
  });
  return wrap;
}

function quizBody() {
  const today = londonToday();
  const n = dayNumber(today);

  if (n < 1) {
    const days = 1 - n;
    return el(`<div class="card"><div class="empty">
      Poppies Daily starts on Saturday 22 August, at home to Peterborough Sports.
      ${days === 1 ? "That is tomorrow." : `That is ${days} days away.`}
    </div></div>`);
  }

  const questions = todaysQuiz();
  if (!questions) {
    return el(`<div class="card"><div class="empty">
      No questions set for today. That is our fault, not yours - it will be back tomorrow.
    </div></div>`);
  }

  const done = db.quizResultFor(today);
  if (done) return quizResult(today, done, questions);

  const answers = state.dailyAnswers || [];
  const i = answers.length;
  const q = questions[i];

  const card = el(`
    <div class="card">
      <div class="quiz__head">
        <span class="quiz__num">Poppies Daily #${n}</span>
        <span class="quiz__dots">${questions.map((_, k) =>
          `<i class="${k < i ? (answers[k] ? "is-right" : "is-wrong") : k === i ? "is-now" : ""}"></i>`).join("")}</span>
      </div>
      <p class="quiz__q">${esc(q.q)}</p>
      <div class="quiz__opts"></div>
    </div>`);

  const opts = card.querySelector(".quiz__opts");
  q.a.forEach((option, k) => {
    const btn = el(`<button class="quiz__opt">${esc(option)}</button>`);
    btn.addEventListener("click", () => {
      if (btn.closest(".quiz__opts").classList.contains("is-locked")) return;
      opts.classList.add("is-locked");
      const right = k === q.c;
      opts.querySelectorAll(".quiz__opt")[q.c].classList.add("is-right");
      if (!right) btn.classList.add("is-wrong");
      if (q.note) card.append(el(`<p class="quiz__note">${esc(q.note)}</p>`));

      const next = el(`<button class="btn btn--full" style="margin-top:12px">${
        i === questions.length - 1 ? "See how you did" : "Next question"}</button>`);
      next.addEventListener("click", () => {
        state.dailyAnswers = [...answers, right];
        if (state.dailyAnswers.length === questions.length) {
          const marks = state.dailyAnswers.map((a) => (a ? "1" : "0")).join("");
          db.saveQuizResult(today, state.dailyAnswers.filter(Boolean).length, marks);
          state.dailyAnswers = [];
        }
        render();
      });
      card.append(next);
    });
    opts.append(btn);
  });
  return card;
}

function quizResult(date, result, questions) {
  const streak = db.quizStreak(date);
  const wrap = el(`
    <div class="card">
      <div class="quiz__score">${result.score}<span>/5</span></div>
      <div class="quiz__grid">${quizGrid(result.marks)}</div>
      ${streak > 1 ? `<p class="quiz__streak">🔥 ${streak} day streak</p>` : ""}
      <p class="hint" style="margin-top:10px">Next five at midnight.</p>
    </div>`);

  const row = el(`<div class="btn-row" style="margin-top:14px"></div>`);
  const copy = el(`<button class="btn btn--sm">Copy result</button>`);
  copy.addEventListener("click", () => shareResult(date, result.marks));
  row.append(copy);
  if (navigator.share) {
    const s = el(`<button class="btn btn--sm btn--ghost">Share…</button>`);
    s.addEventListener("click", () => {
      navigator.share({ text: shareText(date, result.marks) }).catch((e) => {
        if (e?.name !== "AbortError") toast("Could not open the share sheet.");
      });
    });
    row.append(s);
  }
  wrap.append(row);

  /* The answers, once they can no longer be used to score better. */
  if (questions) {
    const list = el(`<div style="margin-top:18px"></div>`);
    questions.forEach((q, k) => {
      list.append(el(`
        <div class="quiz__review">
          <span class="quiz__review-mark">${result.marks[k] === "1" ? "🟩" : "⬜"}</span>
          <div><p>${esc(q.q)}</p><p class="hint">${esc(q.a[q.c])}${q.note ? `. ${esc(q.note)}` : ""}</p></div>
        </div>`));
    });
    wrap.append(list);
  }

  if (!db.currentUser()) {
    wrap.append(joinPrompt({
      heading: "Keep your streak",
      blurb: "Your run is on this device only. Signing in saves it, carries it to your phone and puts you on the leaderboard.",
      points: [
        "Your streak follows you between devices",
        "Your name on the Poppies Daily table",
        "Nothing lost, today counts either way",
      ],
    }));
  }
  return wrap;
}

function quizBoard() {
  const box = el(`<div><div class="skeleton" style="height:200px"></div></div>`);
  db.quizLeague().then((rows) => {
    box.innerHTML = "";
    if (!rows.length) {
      box.append(el(`<div class="empty"><b>Nobody has played yet</b>Be the first.</div>`));
      return;
    }
    const me = db.currentUser()?.id;
    box.append(el(`
      <div class="table-wrap">
        <table class="league">
          <thead><tr><th>#</th><th>Supporter</th><th>🔥</th><th>P</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr class="${r.profile_id === me ? "is-ktfc" : ""}">
                <td>${i + 1}</td>
                <td><div class="club-cell">${namePlusTag(r.profile_id, r.display_name)}</div></td>
                <td>${r.streak}</td>
                <td>${r.played}</td>
                <td class="pts">${r.points}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`));
  }).catch(() => {
    box.innerHTML = "";
    box.append(el(`<div class="empty"><b>Table unavailable</b>Please try again shortly.</div>`));
  });
  return box;
}

/** The nudge on the fixtures page. This is what makes it a daily habit. */
function dailyPromo() {
  const today = londonToday();
  if (dayNumber(today) < 1) return null;
  const done = db.quizResultFor(today);
  const streak = db.quizStreak(today);
  const card = el(`
    <button class="daily-promo" data-nav="daily">
      <span class="daily-promo__icon">🌺</span>
      <span class="daily-promo__text">
        <strong>Poppies Daily #${dayNumber(today)}</strong>
        <span>${done
          ? `${quizGrid(done.marks)} ${done.score}/5 today`
          : "Five questions. Same five for everyone."}${streak > 1 ? ` · 🔥 ${streak}` : ""}</span>
      </span>
      <span class="daily-promo__go">${done ? "Result" : "Play"}</span>
    </button>`);
  return card;
}

/** "On this day in 2019…". Renders nothing at all when there is no match. */
function onThisDayCard() {
  const box = el(`<div></div>`);
  ensureArchive().then(() => {
    if (!state.archive) return;
    const mmdd = londonToday().slice(5);
    const hits = state.archive.matches
      .filter((m) => m.date.slice(5) === mmdd && m.opponent)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!hits.length) return;
    const m = hits[0];
    const res = m.us > m.them ? "beat" : m.us < m.them ? "lost to" : "drew with";
    box.append(el(`
      <div class="otd">
        <span class="otd__year">${m.date.slice(0, 4)}</span>
        <span>On this day, Kettering ${res} ${esc(m.opponent)} ${m.us}-${m.them}${
          m.venue === "Home" ? " at Latimer Park" : ` away`}${m.att ? `, watched by ${m.att.toLocaleString("en-GB")}` : ""}.
          ${hits.length > 1 ? `<a data-nav="archive">and ${hits.length - 1} more</a>` : ""}</span>
      </div>`));
  }).catch(() => { /* a nicety, never an error */ });
  return box;
}

function viewArchive() {
  const wrap = el(`
    <div>
      <div class="page-head">
        <h1>Player Archive</h1>
        <p>Everyone who has pulled on a Kettering shirt since 2018.</p>
      </div>
      <div class="otd" style="align-items:flex-start">
        <span class="otd__year" aria-hidden="true">!</span>
        <span>Put together from the league's old team sheets, so treat it as a good guide
        rather than the last word. Names are sometimes misspelt at source and the odd
        appearance will be missing. Spotted something wrong?
        <a data-nav="feedback">Tell us</a> and we will fix it.</span>
      </div>
    </div>`);
  const box = el(`<div><div class="skeleton" style="height:300px"></div></div>`);
  wrap.append(box);

  ensureArchive().then(() => {
    box.innerHTML = "";
    if (!state.archiveIndex?.size) {
      box.append(el(`<div class="empty"><b>Archive unavailable</b>Please try again shortly.</div>`));
      return;
    }
    const all = [...state.archiveIndex.values()].sort((a, b) => b.apps - a.apps);
    const search = el(`<div class="field" style="margin-bottom:12px">
      <input id="arch-q" placeholder="Search for a player" aria-label="Search the archive"></div>`);
    const list = el(`<div></div>`);
    const draw = (rows) => {
      /* Apps and a list of seasons was thin. Won, drawn and lost put a career
         in some sort of order, and the percentage is the column people will
         actually sort by. Everything here comes off team sheets we already had. */
      list.innerHTML = rows.length ? `
        <div class="table-wrap">
          <table class="league arch">
            <thead><tr>
              <th>Player</th><th>Apps</th><th>W</th><th>D</th><th>L</th>
              <th>Won</th><th title="Times they captained the side">Capt</th>
              <th class="arch__seasons">Seasons</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => {
                const played = r.won + r.drew + r.lost;
                const pct = played ? Math.round((r.won / played) * 100) : null;
                return `
                <tr data-player="${esc(r.name)}" style="cursor:pointer">
                  <td><div class="club-cell"><span>${esc(r.name)}</span>${
                    r.goals ? `<span class="arch__goals" title="Goals this season">${r.goals}</span>` : ""
                  }</div></td>
                  <td>${r.apps}</td>
                  <td>${r.won}</td>
                  <td>${r.drew}</td>
                  <td>${r.lost}</td>
                  <td>${pct === null ? "&mdash;" : `${pct}%`}</td>
                  <td class="${r.captain ? "arch__capt" : "hint"}">${r.captain || "&mdash;"}</td>
                  <td class="hint arch__seasons">${[...r.seasons].sort().join(", ")}</td>
                </tr>`; }).join("")}
            </tbody>
          </table>
        </div>` : `<div class="empty"><b>Nobody by that name</b>Try a surname.</div>`;
    };
    draw(all);
    search.querySelector("input").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all);
    });
    box.append(search, list);
    box.append(el(`<p class="hint" style="margin-top:12px">
      ${all.length} players across ${state.archive.matches.length} matches. The league's
      records name no goalscorers before this season, so there are no goal counts here.</p>`));
  }).catch(() => {
    box.innerHTML = "";
    box.append(el(`<div class="empty"><b>Archive unavailable</b>Please try again shortly.</div>`));
  });
  return wrap;
}

/* ========================================================= archive project

   A teaser, honestly labelled as one. Nothing is built, no dates are promised,
   and the only thing the page actually does is let somebody put their hand up.
   The scanning is the part that will sink it if nobody helps, so that is the
   offer asked for first.                                                    */

const ARCHIVE_HELP = [
  ["canScan", "I could help with the scanning",
   "The big one. Feeding programmes through a scanner, page by page, and naming the files."],
  ["hasMedia", "I have material to lend",
   "Programmes, tapes, photos, tickets, handbooks, anything Kettering."],
  ["canCatalogue", "I could help catalogue",
   "Typing in dates, opponents and scorers so the collection can be searched."],
  ["canStore", "I could help with kit or storage",
   "A scanner, a VHS deck, somewhere dry to keep things while they are worked on."],
];

/* ============================================================ what it costs */

/**
 * What it costs to watch Kettering, and where that sits in the division.
 *
 * Grown out of the Association's season ticket review on the old site, but the
 * season ticket half is gone: the early bird closed on 31 May and nobody
 * mid-season is deciding whether to buy one. What is left is the thing a
 * supporter actually needs on a Saturday, and it is built on our own data --
 * every price checked against the club's own site and carrying the date.
 *
 * The old review's "£219 peer average" for season tickets is not repeated
 * anywhere. Its footnote said ten clubs, it showed five, those five average
 * £229.60, and they were 2025/26 prices set against Kettering's 2026/27.
 */
function viewValue() {
  const wrap = el(`<div></div>`);
  const v = state.valueReview;

  if (!v) {
    wrap.append(el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`));
    loadValueReview().then(() => { if (state.view === "value") render(); });
    return wrap;
  }

  const KT = KTFC.adultPrice;
  const prices = TEAMS.map((t) => t.adultPrice).filter((n) => typeof n === "number");
  const all = [...prices, KT].sort((a, b) => b - a);
  const mean = all.reduce((n, x) => n + x, 0) / all.length;
  const rank = all.indexOf(KT) + 1;
  const joint = all.filter((x) => x === KT).length - 1;
  const dearer = KT > mean;

  wrap.append(el(`
    <div class="page-head page-head--airy">
      <h1>What it costs</h1>
      <p>What you pay on the gate at Latimer Park, and how that compares with the
         ${TEAMS.length} other clubs in the division.</p>
    </div>`));

  /* What a supporter actually pays on Saturday, before any comparison. */
  const mine = el(`<div class="card"></div>`);
  mine.append(el(`
    <div class="info-grid info-grid--3">
      <div class="info"><div class="info__label">${esc(KTFC.adultRange)}</div>
        <div class="info__value" style="color:var(--accent)">${money(KT)}</div></div>
      <div class="info"><div class="info__label">${esc(KTFC.concessionRange)}</div>
        <div class="info__value">${money(KTFC.concessionPrice)}</div></div>
      <div class="info"><div class="info__label">${esc(KTFC.youthRange)}</div>
        <div class="info__value">${money(KTFC.youthPrice)}</div></div>
    </div>`));
  mine.append(el(`<p class="hint">${esc(KTFC.priceNote)}</p>`));
  wrap.append(mine);

  /* ------------------------------------------------- against the division */
  wrap.append(el(`<h2 class="section-title">Against the division</h2>`));
  const gate = el(`<div class="card"></div>`);
  gate.append(el(`
    <div class="info-grid info-grid--3">
      <div class="info"><div class="info__label">Kettering</div>
        <div class="info__value" style="color:var(--accent)">${money(KT)}</div></div>
      <div class="info"><div class="info__label">Division average</div>
        <div class="info__value">${pounds(mean)}</div></div>
      <div class="info"><div class="info__label">Dearest</div>
        <div class="info__value">${rank}<span style="font-size:0.8125rem;color:var(--text-3)"> of ${all.length}</span></div></div>
    </div>`));
  gate.append(el(`
    <p class="club-overview" style="margin-top:12px">An adult at Latimer Park is
    <b>${pounds(Math.abs(KT - mean))} ${dearer ? "above" : "below"} the division average</b>, the
    ${ordinal(rank)} dearest of ${all.length}${
      joint ? `, level with ${joint} other club${joint > 1 ? "s" : ""}` : ""
    }. Concessions at ${money(KTFC.concessionPrice)} sit almost exactly on the average, so it is
    the adult price that stands out rather than the whole card.</p>`));

  /* Every club, so nobody has to take the average on trust. */
  const chart = el(`<div class="bars" style="margin-top:14px"></div>`);
  const rows = [...TEAMS.filter((t) => typeof t.adultPrice === "number")
    .map((t) => ({ name: t.name, price: t.adultPrice, us: false })),
    { name: "Kettering Town", price: KT, us: true }]
    .sort((a, b) => b.price - a.price);
  const top = rows[0].price;
  rows.forEach((r) => {
    chart.append(el(`
      <div class="bar${r.us ? " bar--us" : ""}">
        <span class="bar__name">${esc(r.name)}</span>
        <span class="bar__track"><span class="bar__fill" style="width:${(r.price / top) * 100}%"></span></span>
        <span class="bar__val">${money(r.price)}</span>
      </div>`));
  });
  gate.append(chart);
  gate.append(el(`
    <p class="note" style="margin-top:12px">${esc(v.sourceNote)} Open any club in the
    <button class="link-btn" data-nav="clubs">Away Guide</button> to see the source and the date
    behind its price.</p>`));
  wrap.append(gate);

  /* ------------------------------------------------------ still unanswered */
  wrap.append(el(`<h2 class="section-title">Still unanswered</h2>`));
  const open = el(`<div class="card"></div>`);
  v.openQuestions.forEach((q, i) => {
    open.append(el(`
      <div class="value">
        <span class="value__num">${i + 1}</span>
        <span class="value__text"><span class="value__body">${esc(q)}</span></span>
      </div>`));
  });
  wrap.append(open);

  wrap.append(el(`
    <p class="note" style="margin-top:16px">Checked ${esc(fmtDate(v.checked))}. If you spot a price
    that is wrong, <a href="mailto:${esc(CONFIG.credit.email)}">tell us</a> and we will fix it.</p>`));

  return wrap;
}

/* ================================================ supporters' association */

/**
 * Who the Association is, what it stands for, and the questions people keep
 * asking. Carried over from the old ktfcsa.com pages so this app can be the
 * one place, rather than the third place, supporters have to look.
 *
 * The content lives in data/association.json so the roster and the answers can
 * be edited without going near this file.
 */
function viewAssociation() {
  const wrap = el(`<div></div>`);
  const a = state.association;

  if (!a) {
    wrap.append(el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`));
    loadAssociation().then(() => { if (state.view === "association") render(); });
    return wrap;
  }

  wrap.append(el(`
    <div class="page-head page-head--airy">
      <h1>Supporters' Association</h1>
      <p>${esc(a.strapline)}</p>
    </div>`));

  const intro = el(`<div class="card"></div>`);
  a.intro.forEach((para, i) => {
    intro.append(el(`<p class="club-overview"${i ? ' style="margin-top:12px"' : ""}>${esc(para)}</p>`));
  });
  wrap.append(intro);

  /* The consultation is the thing we most want somebody landing here to find,
     so it goes above everything except the introduction, and only while it is
     actually worth their time. */
  const cs = consultState();
  if (cs === "open" || cs === "closed" || cs === "published") {
    const line = cs === "open"
      ? `The fan consultation is open until ${CLOSES_WORDS}.`
      : cs === "closed"
        ? "The fan consultation has closed. The results are being checked."
        : "The results of the fan consultation are published.";
    const go = el(`
      <button class="daily-promo" data-nav="consult">
        <span class="daily-promo__icon">📣</span>
        <span class="daily-promo__text">
          <strong>Have Your Say</strong>
          <span>${esc(line)}</span>
        </span>
        <span class="daily-promo__go">${cs === "open" ? "Take part" : "See it"}</span>
      </button>`);
    wrap.append(go);
  }

  wrap.append(el(`<h2 class="section-title">What we stand for</h2>`));
  const vals = el(`<div class="card"></div>`);
  a.values.forEach((v, i) => {
    vals.append(el(`
      <div class="value">
        <span class="value__num">${i + 1}</span>
        <span class="value__text">
          <b class="value__title">${esc(v.title)}</b>
          <span class="value__body">${esc(v.text)}</span>
        </span>
      </div>`));
  });
  wrap.append(vals);

  wrap.append(el(`<h2 class="section-title">Who we are</h2>`));
  const who = el(`<div class="card"></div>`);
  a.group.forEach((m) => {
    const name = m.url
      ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a>`
      : esc(m.name);
    who.append(el(`
      <div class="crew">
        <span class="crew__who">${name}${
          m.doing ? `<span class="crew__note">${esc(m.doing)}</span>` : ""
        }</span>
        <span class="crew__when">${esc(m.role)}</span>
      </div>
      ${m.fact ? `<p class="value__fact">${esc(m.fact)}</p>` : ""}`));
  });
  who.append(el(`
    <p class="note" style="margin:14px 0 0">This is a working group, not a committee. If you want
    to be on it, <a href="mailto:${esc(a.committeeEmail)}">email us</a>.</p>`));
  wrap.append(who);

  wrap.append(el(`<h2 class="section-title">Questions people ask</h2>`));
  const faqs = el(`<div></div>`);
  a.faqs.forEach((f) => {
    faqs.append(foldable(f.q, () => {
      const box = el(`<div></div>`);
      f.a.forEach((para, i) => {
        box.append(el(`<p class="club-overview"${i ? ' style="margin-top:10px"' : ""}>${esc(para)}</p>`));
      });
      return box;
    }));
  });
  wrap.append(faqs);

  wrap.append(el(`<h2 class="section-title">Get in touch</h2>`));
  const contact = el(`
    <div class="card">
      <p class="club-overview">Anything at all: a question, an offer of help, or something you
      think we have got wrong.</p>
    </div>`);
  const row = el(`<div class="btn-row" style="margin-top:12px"></div>`);
  row.append(el(`<a class="btn btn--sm" href="mailto:${esc(a.email)}">${esc(a.email)}</a>`));
  Object.entries(a.social).forEach(([name, url]) => {
    const label = name === "x" ? "X" : name[0].toUpperCase() + name.slice(1);
    row.append(el(`
      <a class="btn btn--sm btn--ghost" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`));
  });
  contact.append(row);
  wrap.append(contact);

  wrap.append(el(`
    <p class="note" style="margin-top:16px">Kettering Town FC Supporters' Association, established
    ${esc(String(a.established))}. Independent of the club, free to take part in, and run by
    supporters in their own time.</p>`));

  return wrap;
}

function viewHeritage() {
  const wrap = el(`
    <div>
      <div class="page-head">
        <h1>The Poppies Archive</h1>
        <p>A plan to get the club's history off the shelf and onto a screen, before any more of
           it is lost. Early days, and we could use a hand.</p>
      </div>

      <h2 class="section-title">What we would like to do</h2>
      <div class="card">
        <p class="club-overview">Kettering Town have been going since 1872, and a great deal of
        that history is sitting in lofts and garages around the town. Matchday programmes, video
        tapes of games nobody has seen in thirty years, photographs, ticket stubs, handbooks,
        newspaper cuttings. Not in a museum. In boxes.</p>
        <p class="club-overview" style="margin-top:12px">The idea is to scan and record the lot,
        properly, and put it somewhere every Poppies supporter can reach for nothing. You would
        keep whatever you lend us. We would take a copy, hand it straight back, and the digital
        version would carry your name as the source if you wanted it to.</p>
      </div>

      <h2 class="section-title">Why bother now</h2>
      <div class="card">
        <p class="club-overview">Because it is going. VHS does not last, and the tapes from the
        eighties are already past the age where playing them is a gamble. Newsprint yellows and
        goes brittle. Programmes get thrown out in house clearances by people who had no idea
        anybody wanted them. Every year that passes, a bit more of it goes in a skip.</p>
        <p class="club-overview" style="margin-top:12px">There is a personal side to it as well.
        There are hundreds of programmes here going back to the sixties, and it seems daft to
        have them sat in a cupboard when they could be shared.</p>
      </div>

      <!-- Kept, because it is true, but no longer the first thing on the page.
           Opening with "this might never happen and you will not hear about it
           again" is a reason to close the tab, and one offer in three weeks
           suggested people were taking it. -->
      <div class="soon">
        <span class="soon__tag">An idea, not a promise</span>
        <p>Nothing is built yet and there is no date. Whether it starts depends on how many
           people put their hand up. If that turns out to be too few, it stays an idea, and you
           will not hear about it again.</p>
      </div>

      <h2 class="section-title">Where the work is</h2>
      <div class="card">
        <p class="club-overview">Almost all of it is legwork. Scanning is not difficult, it is
        just slow, and a programme is twenty-odd pages. One person doing it alone would still be
        going in ten years. A dozen people doing an hour here and there would get somewhere.</p>
        <p class="club-overview" style="margin-top:12px">So this is not a request for money or for
        anybody clever. It is a request for patience and a free evening now and then.</p>
      </div>
    </div>`);

  wrap.append(el(`<h2 class="section-title">Could you help?</h2>`));
  wrap.append(archiveOfferPanel());

  wrap.append(el(`
    <p class="hint" style="margin-top:16px">
      Questions, or something you would rather say privately?
      Email <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a>.
      Anything you lend stays yours, and nothing would be published without the owner's say-so.
    </p>`));
  return wrap;
}

/** The offer form, or a reason to join, plus the running totals. */
function archiveOfferPanel() {
  const box = el(`<div><div class="skeleton" style="height:220px"></div></div>`);

  /* A count only helps once there is one worth showing. "1 supporter has
     offered" reads as nobody is doing this, which is the opposite of what a
     number is there for, so below the threshold it says what is needed
     instead. */
  const SHOW_COUNT_FROM = 5;
  const counts = el(`<div></div>`);
  db.archiveCounts().then((c) => {
    if (!c) return;
    if (c.offers >= SHOW_COUNT_FROM) {
      const bits = [`${c.scanners} of them with the scanning`];
      if (c.with_media) {
        bits.push(`${c.with_media} ${c.with_media === 1 ? "has" : "have"} material to lend`);
      }
      counts.append(el(`
        <div class="otd" style="margin-top:14px">
          <span class="otd__year">${c.offers}</span>
          <span>supporters have offered to help so far, ${bits.join(", and ")}.</span>
        </div>`));
      return;
    }
    counts.append(el(`
      <div class="otd" style="margin-top:14px">
        <span class="otd__year">${Math.max(SHOW_COUNT_FROM - (c.offers || 0), 1)}</span>
        <span>more offers and this gets started. It needs about a dozen people doing an hour
        here and there, not one person doing all of it.</span>
      </div>`));
  }).catch(() => { /* counts are a nicety */ });

  if (db.isOnline() && !db.currentUser()) {
    box.innerHTML = "";
    box.append(joinPrompt({
      heading: "Put your hand up",
      blurb: "Offers come through an account so we can get back to you, and so nobody can volunteer somebody else.",
      points: [
        "Say what you could help with, change it whenever you like",
        "Nobody sees your offer except the volunteers running it",
        "Saying yes now commits you to nothing",
      ],
      footer: `Would rather not sign up? Email <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a> and it reaches the same people.`,
    }));
    box.append(counts);
    return box;
  }

  db.archiveOffer().then((existing) => {
    box.innerHTML = "";
    const has = Boolean(existing);
    const form = el(`
      <div class="card">
        ${has ? `<p class="hint" style="margin-bottom:12px">You have already offered. Thank you.
          Change it below whenever you like.</p>` : ""}
        <div class="offer-list"></div>
        <div class="field" style="margin-top:14px">
          <label for="ar-note">Anything else worth knowing (optional)</label>
          <textarea id="ar-note" rows="4" maxlength="600"
            placeholder="I have about 200 programmes from 1974 onwards, and a working VHS player."></textarea>
        </div>
        <button class="btn btn--full" id="ar-save">${has ? "Update my offer" : "Count me in"}</button>
      </div>`);

    const list = $(".offer-list", form);
    ARCHIVE_HELP.forEach(([key, label, blurb]) => {
      const row = el(`
        <label class="offer">
          <input type="checkbox" data-help="${key}"${existing?.[keyToColumn(key)] ? " checked" : ""}>
          <span><b>${esc(label)}</b><span class="hint">${esc(blurb)}</span></span>
        </label>`);
      list.append(row);
    });
    $("#ar-note", form).value = existing?.note || "";

    $("#ar-save", form).addEventListener("click", async () => {
      const offer = Object.fromEntries(
        ARCHIVE_HELP.map(([key]) => [key, $(`[data-help="${key}"]`, form).checked])
      );
      offer.note = $("#ar-note", form).value.trim();
      if (!Object.values(offer).some(Boolean)) {
        toast("Tick at least one thing, or send an email instead.");
        return;
      }
      try {
        await db.saveArchiveOffer(offer);
        toast(has ? "Offer updated. Thank you." : "Thank you. We will be in touch when there is something to do.");
        render();
      } catch (err) {
        toast(err.message || "That did not save.");
      }
    });

    box.append(form);
    box.append(counts);
  }).catch(() => {
    box.innerHTML = "";
    box.append(el(`<div class="empty"><b>Not ready yet</b>Offers are not switched on. Email
      <a href="mailto:danny@ktfcsa.com">danny@ktfcsa.com</a> in the meantime.</div>`));
  });

  return box;
}

/* The form speaks camelCase and the row speaks snake_case, as everywhere else. */
const keyToColumn = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);


/* -------------------------------------------------- publishing safeguards */

/* Common words that begin a sentence, or turn up capitalised for ordinary
   reasons. Anything capitalised that is not in here gets flagged. The list
   errs on the short side on purpose: over-flagging costs a second's reading,
   under-flagging is how a name gets published. */
const NOT_A_NAME = new Set(`
  a an the this that these those there here it its it's he she they them their his her our my your
  we you i us and but so or nor yet if when while since after before during given having being
  all any both each every few many more most much no none not other same some such very just only
  again also because how what when where which who whom why would could should must can will may
  do does did done have has had am are is was were be been being get got go going went
  at by for from in into of off on onto out over to under up with without within about
  club team squad supporters fans fan players player manager board committee volunteers volunteer
  kettering town poppies latimer park ktfcsa fc league southern premier central trust association
  communication transparency matchday matchdays ground stadium season january february march april
  may june july august september october november december monday tuesday wednesday thursday
  friday saturday sunday everything something nothing anything nobody somebody everyone anyone
  personally honestly frankly obviously clearly hopefully unfortunately
`.trim().split(/\s+/));

/**
 * A rough guess at whether something names a person or a company.
 *
 * Any capitalised word that is not an ordinary one, wherever it sits. It used
 * to skip the first word of each sentence, which is tidier and useless: the
 * comment that went live during testing began "George has lied over and over
 * again" and sailed straight through. Over-flagging is the right way to be
 * wrong here, so common words are listed rather than positions guessed.
 *
 * A prompt to read carefully, not a filter. It will miss things.
 */
function looksLikeItNames(text) {
  const hits = [];
  for (const raw of String(text || "").split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z'-]/g, "");
    if (w.length < 3) continue;
    if (!/^[A-Z][a-z'-]+$/.test(w)) continue;
    if (NOT_A_NAME.has(w.toLowerCase())) continue;
    if (!hits.includes(w)) hits.push(w);
  }
  return hits;
}

/**
 * Shows exactly what is about to become public, and asks. Approving used to be
 * a single unconfirmed tap, which is how a comment naming somebody went live
 * during testing within a minute of the first response arriving.
 */
function confirmPublish({ text, kind, attribution, onYes }) {
  const names = looksLikeItNames(text);
  const isQuestion = kind === "Question for the club";
  const { node, close } = modal(`
    <h3 style="margin-bottom:10px">Publish this?</h3>
    <p class="hint" style="margin-bottom:10px">It will appear on the public results page${
      isQuestion ? " and be sent to the club in writing" : ""}, exactly as written below${
      attribution ? `, credited to ${esc(attribution)}` : ", with no name against it"}.</p>
    <blockquote class="quote" style="margin-bottom:12px">${esc(text)}</blockquote>
    ${names.length ? `
      <div class="warn">
        <b>This looks like it names someone: ${esc(names.join(", "))}</b>
        Publishing a claim about a named person or company is the part that carries real risk,
        and it is you doing the publishing. If it states something as fact rather than asking a
        question, edit it or leave it pending. The response still counts towards every number
        either way.
      </div>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--sm" data-yes>Yes, publish it</button>
      <button class="btn btn--sm btn--ghost" data-no>Cancel</button>
    </div>`);
  node.querySelector("[data-yes]").addEventListener("click", () => { close(); onYes(); });
  node.querySelector("[data-no]").addEventListener("click", close);
}

/* ========================================================== fan consultation

   A time-limited survey on how the club is being run, Monday 17 to Friday 21
   August 2026, with the results published on the Saturday.

   Two things shape the whole of this. The numbers are public and the words are
   not: nothing anybody writes appears here or goes to the club until a
   volunteer has read it. And nothing on this page asserts anything. It asks
   about what a supporter can see for themselves, it measures how well people
   feel represented rather than telling them, and where it asks about action it
   reports what supporters would support and recommends none of it.        */

const CONSULT_OPENS  = "2026-08-17T00:00";
/* Midday Friday, at the ground, not on the device. The database enforces the
   same instant through consultation_open(), because a closing time a browser
   can argue with is not a closing time. */
const CONSULT_CLOSES = "2026-08-21T12:00";
const CLOSES_WORDS = "midday on Friday 21 August";

/**
 * Four states, not three. Closing and publishing are different things: the
 * consultation shuts at midday on the Friday and the findings go out that
 * evening, when a volunteer presses the button. On a timer it would publish at
 * midday with whatever had been read by lunchtime.
 *
 * "closed" is the gap between the two, and it is worth having on its own: it
 * shows the turnout at the hour interest peaks.
 */
const consultState = () => {
  const now = londonStamp();
  if (now < CONSULT_OPENS) return "before";
  if (now < CONSULT_CLOSES) return "open";
  return state.resultsPublic ? "published" : "closed";
};

/* Who supporters might feel represented by. Roles, not names. */
/* Bodies, not roles, and never names.
   Listing the president or the secretary looks neutral and is not: at a club
   this size each of those is one identifiable person, so rating the role is
   rating them, and a finding about a named individual is a different and much
   riskier thing to publish than a finding about a board. */
const CONSULT_BODIES = [
  ["ownership", "The club's ownership"],
  ["board", "The club board"],
  ["trust", "The Supporters' Trust"],
  ["sponsors", "The club's commercial partners"],
];
/* Five points from very poor to very good, with "don't know" set apart below,
   so nobody has to park a real opinion in the same row as no opinion. Laid out
   as a block per body rather than a table: five columns and a label do not fit
   across a phone, and a cramped grid is the opposite of a clear question. */
const VERDICTS = [
  ["very-poor", "Very poor"],
  ["poor", "Poor"],
  ["ok", "Neither"],
  ["good", "Good"],
  ["very-good", "Very good"],
];
const VERDICT_UNSURE = ["unsure", "Don't know"];

/* Things a supporter can actually observe. Nothing here asks anyone to repeat
   a rumour, and there is deliberately no option about anybody's honesty. */
const CONSULT_POSITIVES = [
  ["team", "The team on the pitch"],
  ["manager", "The manager and coaching"],
  ["ground", "Latimer Park itself"],
  ["matchday", "The matchday experience"],
  ["community", "Work in the community"],
  ["ambition", "Ambition for the club"],
];
const CONSULT_CONCERNS = [
  ["volunteers", "Volunteers leaving"],
  ["communication", "Communication from the club"],
  ["transparency", "How decisions are explained"],
  ["matchday", "How matchdays are run"],
  ["sponsors", "How the club and its partners conduct themselves publicly"],
  ["ground", "The ground and facilities"],
  ["finance", "Financial sustainability"],
];
/* Alphabetical, and "nothing at all" is a real answer sitting among the rest.
   We are asking, not proposing. */
const CONSULT_ACTIONS = [
  ["banners", "Banners at a game"],
  ["boycott", "Boycotting a fixture"],
  ["applause", "Coordinated applause in a chosen minute"],
  ["letter", "An open letter"],
  ["meeting", "Asking for a public meeting"],
  ["shop", "Withholding spend in the club shop and bar"],
  ["stay", "Staying behind at full time"],
  ["none", "Nothing. I would rather things were settled quietly"],
];


/**
 * How many have answered so far, live. Public, because the number is the best
 * argument for adding to it: a supporter who can see that two hundred people
 * have already bothered is far more likely to bother themselves.
 *
 * Reads the aggregate view, which is counts only and exposes nobody.
 */
function consultCount({ compact = false } = {}) {
  const box = el(`<div></div>`);
  db.consultationResults().then((r) => {
    const n = r?.summary?.responses || 0;
    if (!n) return;
    const members = r.summary.from_members || 0;
    box.append(el(compact
      ? `<span class="tally">${n} answered so far</span>`
      : `<div class="otd" style="margin-bottom:var(--gap)">
           <span class="otd__year">${n}</span>
           <span>${n === 1 ? "supporter has" : "supporters have"} answered so far${
             members ? `, ${members} of them signed in to an account` : ""}.
             ${consultState() === "open" ? `Closes ${CLOSES_WORDS}.` : ""}</span>
         </div>`));
  }).catch(() => { /* a count is a nicety, never an error */ });
  return box;
}

function viewConsult() {

  askIfPublished();

  const wrap = el(`
    <div>
      <div class="page-head page-head--airy">
        <h1>The consultation report</h1>
        <p>An independent consultation by the Kettering Town FC Supporters' Association on how the
           club is being run. It closed on 21 August. Everything supporters said is below, along
           with what we have put to the club and how long each question has gone unanswered.</p>
      </div>
    </div>`);

  const phase = consultState();

  wrap.append(consultCount());

  /* Checked before the phase branches, not after. It used to sit below them,
     so once the consultation closed the "closed" branch returned first and the
     preview was unreachable for everybody including volunteers -- which is the
     one moment it exists for.

     Before Saturday, a named few can see the findings so they can prepare.
     Read-only and clearly marked as not public: it is the same aggregate data
     everybody gets later, never anybody's raw response. */
  /* The pass only means anything before the findings are public. After that
     everybody sees them anyway, so it stops granting a thing whether or not
     somebody remembers to clear the flag. */
  if (state.params?.id === "preview" && consultState() !== "published" && db.canViewResults()) {
    wrap.append(el(`
      <div class="soon">
        <span class="soon__tag">Preview \u00b7 not public yet</span>
        <p>This is the report itself, not a mock-up of it: the same page supporters get, drawn
        from the same numbers, the moment it is published. What is missing is only what has not
        been approved yet, so anything blank here will be blank on the night.
        ${consultState() === "open"
          ? `The consultation is still running, so the figures will move.`
          : `The consultation has closed, so these are the final figures.`}
        Please do not share them until it is out.</p>
      </div>`));
    wrap.append(consultResults());
    return wrap;
  }

  if (phase === "before") {
    wrap.append(el(`
      <div class="soon">
        <span class="soon__tag">Opens Monday morning</span>
        <p>From Monday 17 August until ${CLOSES_WORDS} we are asking supporters what they make of
        the way the club is being run. The results go up here on Saturday, and every question
        supporters ask will be put to the club in writing.</p>
      </div>`));
    wrap.append(consultAbout());
    return wrap;
  }

  if (phase === "published") {
    wrap.append(consultResults());
    return wrap;
  }

  /* Closed, but not out yet. Says what the turnout was, because that is the
     number worth having in front of people while they are waiting. */
  if (phase === "closed") {
    const box = el(`
      <div class="soon">
        <span class="soon__tag">Consultation closed</span>
        <p>Thank you to everybody who took part. The findings, and every question supporters
        asked, go up here this evening once they have been checked over.</p>
      </div>`);
    wrap.append(box);
    db.consultationResults().then((r) => {
      const n = r?.summary?.responses || 0;
      if (!n) return;
      box.append(el(`<p class="hint" style="margin-top:10px"><b>${n} supporters</b> answered in
        five days, ${r.summary.from_members} of them signed in to an account.</p>`));
    }).catch(() => {});
    wrap.append(consultAbout());
    return wrap;
  }

  if (db.hasAnswered()) {
    wrap.append(el(`
      <div class="soon">
        <span class="soon__tag">Thank you</span>
        <p>Your answers are in. It closes at ${CLOSES_WORDS} and the results go up here on
        Saturday 22 August, with every question supporters asked put to the club in writing.</p>
      </div>`));
    wrap.append(consultAbout());
    return wrap;
  }

  wrap.append(consultAbout());
  wrap.append(consultForm());
  return wrap;
}

/** What this is, who is running it and what happens to an answer. */
function consultAbout() {
  return el(`
    <div class="card">
      <p class="club-overview">It is no secret that there is a lot of news and rumour going round
      social media at the moment. Some of it is worth taking seriously, some of it is not, and
      almost none of it is anywhere you could point at. We wanted to try and capture all of it in
      one useful place, in a form we can actually put to the club, rather than leave it scattered
      across comment threads where it does nobody any good.</p>
      <p class="club-overview" style="margin-top:12px">So this is not a petition and it is not a
      campaign. It is a straight set of questions about what supporters are seeing, what they are
      worried about, what they think is going well, and what they want the club to answer. The
      more people who fill it in, the harder it is to wave away, and the more it speaks for the
      terrace rather than for whoever shouts loudest online.</p>
      <p class="club-overview" style="margin-top:12px"><b class="subhead">This is not a one-off</b>
      ${(() => {
        /* The real number when we have it, a rounded one when the count has not
           loaded yet. Never a made-up figure. */
        const n = db.supporterCount();
        return n
          ? `Around ${Math.round(n / 10) * 10} supporters have signed up here already`
          : "Around a hundred supporters have signed up here already";
      })()}, and the survey we ran in May drew 189 responses. Plenty of you said then that you
      would turn out for meetings, in a room and online both, which is why there is a question
      about that further down. The aim is something that keeps going, not a survey that gets
      posted once and forgotten.</p>
      <p class="club-overview" style="margin-top:12px"><b class="subhead">Being straight with you</b> The
      Supporters' Association is not fully off the ground yet. There is no committee, no
      constitution and no membership list, and in an ideal world all of that would have come
      first. Given what is going on around the club we thought it mattered more to get this
      gathered properly now than to wait until the paperwork was tidy. If enough people take part,
      this becomes the thing a proper fan group is built on rather than a survey that sat in a
      drawer.</p>
      <p class="club-overview" style="margin-top:12px"><b class="subhead">Who is asking?</b> The Supporters'
      Association is independent of the club. It is not funded by the club and speaks only for the
      supporters who answer.</p>
      <p class="club-overview" style="margin-top:12px"><b class="subhead">What happens to your answer?</b> The
      numbers are published as numbers. Anything you write is read by a volunteer first, and is
      published only if you tick the box saying we may. Questions for the club are collected,
      tidied up and sent in writing. If a question goes unanswered we will say so, and say for
      how long.</p>
      <p class="club-overview" style="margin-top:12px"><b class="subhead">What we are not doing</b> We are not
      repeating rumours and we are not asking you to. The questions below are about what you can
      see for yourself. Where we ask about action, we are asking what supporters would support.
      We are not proposing any of it.</p>
    </div>`);
}

/** The form. Only the first two questions are required. */
function consultForm() {
  const box = el(`<div></div>`);

  const tickList = (name, items) => `
    <div class="offer-list">
      ${items.map(([k, label]) => `
        <label class="offer">
          <input type="checkbox" data-${name}="${k}">
          <span><b>${esc(label)}</b></span>
        </label>`).join("")}
    </div>`;

  const form = el(`
    <div class="card">
      <h3 class="consult__q">1. How confident are you in the way Kettering Town is being run?</h3>
      <p class="hint">1 is no confidence at all, 10 is complete confidence.</p>
      <div class="scale" id="c-conf">
        ${[...Array(10)].map((_, i) => `<button type="button" data-conf="${i + 1}">${i + 1}</button>`).join("")}
      </div>

      <h3 class="consult__q">2. Is the club heading in the right direction?</h3>
      <div class="offer-list" id="c-dir">
        ${[["right", "Yes, the right direction"], ["wrong", "No, the wrong direction"], ["unsure", "I am not sure"]]
          .map(([k, l]) => `
            <label class="offer">
              <input type="radio" name="c-direction" value="${k}">
              <span><b>${esc(l)}</b></span>
            </label>`).join("")}
      </div>

      <h3 class="consult__q">3. How well has each of these represented supporters in recent months?</h3>
      <p class="hint">Answer for the ones you have a view on. "Don't know" is a real answer.
      We are asking about the bodies that run the club, not about any individual.</p>
      <div class="rep" id="c-rep">
        ${CONSULT_BODIES.map(([key, label]) => `
          <fieldset class="rep__row">
            <legend class="rep__body">${esc(label)}</legend>
            <div class="rep__scale">
              ${VERDICTS.map(([v, word]) => `
                <label class="rep__cell">
                  <input type="radio" name="rep-${key}" value="${v}">
                  <span class="rep__word">${esc(word)}</span>
                  <span class="sr-only">${esc(label)}: ${esc(word)}</span>
                </label>`).join("")}
              <label class="rep__cell rep__cell--apart">
                <input type="radio" name="rep-${key}" value="${VERDICT_UNSURE[0]}">
                <span class="rep__word">${esc(VERDICT_UNSURE[1])}</span>
                <span class="sr-only">${esc(label)}: ${esc(VERDICT_UNSURE[1])}</span>
              </label>
            </div>
          </fieldset>`).join("")}
      </div>

      <h3 class="consult__q">4. What is going well? Tick anything you would defend.</h3>
      ${tickList("pos", CONSULT_POSITIVES)}
      <div class="field" style="margin-top:12px">
        <label for="c-posnote">Anything else that is going well (optional)</label>
        <textarea id="c-posnote" rows="3" maxlength="600"></textarea>
      </div>

      <h3 class="consult__q">5. What concerns you, if anything?</h3>
      ${tickList("con", CONSULT_CONCERNS)}
      <div class="field" style="margin-top:12px">
        <label for="c-connote">In your own words (optional)</label>
        <textarea id="c-connote" rows="4" maxlength="600"
          placeholder="What have you seen or been told? Please stick to what you know rather than what you have heard second hand."></textarea>
        <div class="hint">Read by a volunteer before anything is published. Please do not accuse
        anybody of anything you cannot stand behind, for your sake as much as ours.</div>
      </div>

      <h3 class="consult__q">6. One question you want the club to answer</h3>
      <div class="field">
        <textarea id="c-question" rows="3" maxlength="400"
          placeholder="For example: the club said three board members stepped down voluntarily. Can it say how many volunteers have left since June, and why?"></textarea>
        <div class="hint">Every question is collected, tidied up and put to the club in writing.
        A clear question is much harder to duck than an accusation.</div>
      </div>

      <h3 class="consult__q">7. If supporters did want to make their feelings known, what would you support?</h3>
      <p class="hint">We are asking, not proposing. Nothing here is planned and nothing is being
      organised. This is a question about what supporters would be behind.</p>
      ${tickList("act", CONSULT_ACTIONS)}

      <h3 class="consult__q">8. Would you come to the first meeting of the Association?</h3>
      <p class="hint">Nothing is booked. We are working out whether there is enough interest to
      arrange one, and whether it needs to be in a room, online, or both.</p>
      <div class="offer-list" id="c-meet">
        ${[["in-person", "Yes, in person in Kettering"],
           ["online", "Yes, but online"],
           ["either", "Yes, either would suit me"],
           ["updates", "I could not come, but keep me posted"],
           ["no", "No"]]
          .map(([k, l]) => `
            <label class="offer">
              <input type="radio" name="c-meeting" value="${k}">
              <span><b>${esc(l)}</b></span>
            </label>`).join("")}
      </div>

      <h3 class="consult__q">9. Your name, if you want it used</h3>
      <div class="field">
        <label for="c-name">Name (optional)</label>
        <input id="c-name" maxlength="60" placeholder="Leave blank to stay anonymous">
      </div>
      <label class="offer" style="margin-top:8px">
        <input type="checkbox" id="c-publish">
        <span><b>You may publish what I have written, with my name if I gave one</b>
        <span class="hint">Leave this unticked and your words still count towards the findings,
        they are just never quoted.</span></span>
      </label>

      <button class="btn btn--full" id="c-send" style="margin-top:18px">Send my answers</button>
      <p class="hint" style="margin-top:10px">Closes at ${CLOSES_WORDS}. One response per device,
      and you cannot change it afterwards, so have a read back before you send.</p>
    </div>`);

  /* Confidence, as a row of buttons rather than a slider: a slider on a phone
     gives you a number you did not mean. */
  let confidence = null;
  form.querySelectorAll("[data-conf]").forEach((b) =>
    b.addEventListener("click", () => {
      confidence = Number(b.dataset.conf);
      form.querySelectorAll("[data-conf]").forEach((o) =>
        o.classList.toggle("is-on", Number(o.dataset.conf) === confidence));
    }));

  form.querySelector("#c-send").addEventListener("click", async () => {
    const direction = form.querySelector('input[name="c-direction"]:checked')?.value;
    if (!confidence) return toast("Please answer question 1.");
    if (!direction) return toast("Please answer question 2.");

    const picks = (attr) => [...form.querySelectorAll(`[data-${attr}]`)]
      .filter((i) => i.checked).map((i) => i.dataset[attr]);
    const representation = {};
    CONSULT_BODIES.forEach(([key]) => {
      const v = form.querySelector(`input[name="rep-${key}"]:checked`)?.value;
      if (v) representation[key] = v;
    });

    const text = (id) => form.querySelector(id).value.trim();
    const answer = {
      confidence, direction, representation,
      positives: picks("pos"), concerns: picks("con"), actions: picks("act"),
      positiveNote: text("#c-posnote") || null,
      concernNote: text("#c-connote") || null,
      question: text("#c-question") || null,
      attribution: text("#c-name") || null,
      meeting: form.querySelector('input[name="c-meeting"]:checked')?.value || null,
      publishOk: form.querySelector("#c-publish").checked,
    };

    /* The same filter every other written thing on the site goes through. */
    for (const [label, value] of [["comment", answer.concernNote], ["comment", answer.positiveNote], ["question", answer.question]]) {
      if (!value) continue;
      const check = db.checkPost(value, { maxLength: 600, minLength: 3 });
      if (!check.ok) return toast(`Your ${label}: ${check.reason}`);
    }

    const btn = form.querySelector("#c-send");
    btn.disabled = true;
    try {
      await db.submitConsultation(answer);
      toast("Thank you. Your answers are in.");
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message || "That did not send. Please try again.");
    }
  });

  box.append(form);
  return box;
}

/** The findings. Numbers first, then supporters in their own words. */
/* The May 2026 survey, the only like-for-like number we have. */
const MAY = { responses: 189, confidence: 8.1 };

/** Ranked bars with a percentage, used wherever a set of choices is counted. */
function rankedBars(rows, labels, total, { max } = {}) {
  const box = el(`<div></div>`);
  const top = max || Math.max(...rows.map((r) => r.people), 1);
  rows.forEach((r) => {
    box.append(el(`
      <div class="dist">
        <span class="dist__key dist__key--wide">${esc(labels[r.choice] || r.choice)}</span>
        <span class="dist__bar"><span class="dist__fill" style="width:${
          Math.round((r.people / top) * 100)}%"></span></span>
        <span class="dist__n">${Math.round((r.people / total) * 100)}%</span>
      </div>`));
  });
  return box;
}

/**
 * How supporters rate a body, as one bar running from very poor to very good.
 *
 * A row of numbers makes the reader do the arithmetic and most will not. The
 * shape of a single bar says it before the labels are read, and the split point
 * between negative and positive is where the eye lands.
 */
function verdictBar(name, counts) {
  const order = [
    ["very-poor", "Very poor", "vp"], ["poor", "Poor", "p"], ["ok", "Neither", "n"],
    ["good", "Good", "g"], ["very-good", "Very good", "vg"], ["unsure", "Not sure", "u"],
  ];
  const total = order.reduce((n, [k]) => n + (counts[k] || 0), 0) || 1;
  const neg = (counts["very-poor"] || 0) + (counts.poor || 0);
  const pos = (counts.good || 0) + (counts["very-good"] || 0);
  const row = el(`
    <div class="verdict">
      <div class="verdict__head">
        <b>${esc(name)}</b>
        <span>${Math.round((neg / total) * 100)}% poor &middot; ${
          Math.round((pos / total) * 100)}% good</span>
      </div>
      <div class="verdict__bar"></div>
      <div class="verdict__key"></div>
    </div>`);
  const bar = row.querySelector(".verdict__bar");
  const key = row.querySelector(".verdict__key");
  order.forEach(([k, label, cls]) => {
    const n = counts[k] || 0;
    if (!n) return;
    bar.append(el(`<span class="verdict__seg verdict__seg--${cls}"
      style="width:${(n / total) * 100}%" title="${esc(label)}: ${n}"></span>`));
    key.append(el(`<span class="verdict__tag"><i class="verdict__dot verdict__dot--${cls}"></i>${
      esc(label)} ${n}</span>`));
  });
  return row;
}

/**
 * The letter that went to the club, reproduced on the page.
 *
 * The letter itself promises that a copy will be published, so this is the
 * page keeping that promise rather than a nicety. Folded away by default: it
 * is long, and anybody who wants the argument in short form has just read it
 * in the report above.
 *
 * The ten questions are not repeated inside it. They are already on this page
 * with their counts and their day counters, and two copies would drift.
 */
/**
 * The open letter on its own.
 *
 * It began as a deep link into the consultation report, and that report is a
 * hundred and eighty thousand pixels tall with the letter ninety thousand down
 * it. Every async load on that page rebuilds the DOM and puts the scroll back
 * to the top, so a link into the middle was racing resets it could not see,
 * and even winning it dropped somebody into the middle of a document with no
 * idea where they were.
 *
 * A letter to the club is a thing in its own right. It gets a page.
 */
function viewLetter() {
  const wrap = el(`<div></div>`);
  wrap.append(el(`<button class="back-link" data-nav="home">\u2190 Home</button>`));
  wrap.append(el(`
    <div class="page-head page-head--airy">
      <h1>Our open letters to the club</h1>
      <p>Written on behalf of the supporters who took part in the consultation, and published in
         full. What they said, and what we have asked the club.</p>
    </div>`));
  /* The clock before the letters. It is the one thing on this page that is
     different from the last time somebody looked. */
  const slot = el(`<div></div>`);
  wrap.append(slot);
  loadLetter().then((L) => {
    const c = replyClock(L);
    if (c) slot.replaceWith(c);
  }).catch((err) => {
    /* A swallowed catch here hid a broken clock completely: no clock, no error,
       nothing to go on. The page is fine without it, so it still fails quietly
       for the supporter, but it says so where somebody can see it. */
    console.warn("The reply clock did not render:", err);
  });

  wrap.append(openLetterSection({ openNewest: true }));

  /* The letters carry the questions inside them, folded, which meant this page
     was two "read it in full" buttons and nothing else. The questions and how
     long each has gone unanswered are the point of the letters, so they are on
     the page rather than one tap behind it. */
  wrap.append(questionsSection());

  wrap.append(el(`<p class="hint" style="margin-top:18px">
    <button class="link-btn" data-nav="consult">Read the full consultation report, with what
    supporters said</button></p>`));
  return wrap;
}

/**
 * Every letter the Association has sent the club, newest first.
 *
 * There was one, and the file and this renderer both assumed there would only
 * ever be one. There are two now and there will be more, so `letters` is a
 * list. A file still holding a single letter is wrapped rather than rejected,
 * because a data file and the code that reads it do not deploy at the same
 * instant.
 */
function lettersOf(L) {
  if (!L) return [];
  if (Array.isArray(L.letters)) return L.letters;
  return L.body ? [L] : [];      /* the old single-letter shape */
}

/** The soonest reply date still outstanding, for the home page ticker. */
function replyDue(L) {
  const today = londonToday();
  return lettersOf(L)
    .map((x) => x.replyBy)
    .filter((d) => d && d >= today)
    .sort()[0] || null;
}

/**
 * The clock on the reply.
 *
 * Two letters have gone and a date was asked for. Between those facts sits the
 * thing supporters actually want to know and the thing the club would rather
 * nobody counted: how long it has been, and how long is left. A date on a page
 * is a fact nobody feels. A number that moves while you look at it is harder to
 * put down.
 *
 * It has to survive the deadline passing, which is nine days away, because the
 * state after it is the one that carries the argument. Nothing here says the
 * club has done anything wrong: it counts, and it stops counting the moment
 * they answer.
 */
/**
 * The same wait, in one quiet line on the home page.
 *
 * The letters page has the clock, ticking to the second, which is right there
 * and would be shouting here. This says what was sent, that nothing has come
 * back, and how long is left, in days. It stops updating below the minute
 * because nobody on a home page needs a second hand.
 *
 * It goes when the wait does: answer the questions and this disappears on its
 * own rather than sitting there out of date.
 */
function replyWaitCard() {
  const box = el(`<div></div>`);

  loadLetter().then((L) => {
    const letters = lettersOf(L).filter((x) => x.sentAt);
    if (!letters.length) return;

    const dates = letters.map((x) => x.replyBy).filter(Boolean).sort();
    const dueISO = dates[0] || null;
    const due = dueISO ? new Date(`${dueISO}T23:59:59+01:00`).getTime() : null;
    const sent = letters.map((x) => new Date(x.sentAt).getTime()).sort((a, b) => a - b);

    const card = el(`
      <button class="replycard" data-nav="letter">
        <span class="replycard__body">
          <span class="replycard__label">Our open letter${letters.length > 1 ? "s" : ""} to the club</span>
          <span class="replycard__what"></span>
          <span class="replycard__state"></span>
        </span>
        <span class="replycard__go" aria-hidden="true">\u203A</span>
      </button>`);

    const what = $(".replycard__what", card);
    const state_ = $(".replycard__state", card);

    const days = Math.max(0, Math.floor((Date.now() - sent[0]) / 86400000));
    what.textContent = letters.length > 1
      ? `Two letters, sent ${fmtDate(new Date(sent[0]).toISOString().slice(0, 10), "short")} and ${
          fmtDate(new Date(sent[sent.length - 1]).toISOString().slice(0, 10), "short")}.`
      : `Sent ${fmtDate(new Date(sent[0]).toISOString().slice(0, 10), "short")}, ${days} day${
          days === 1 ? "" : "s"} ago.`;

    const tick = () => {
      if (!due) { state_.textContent = "No reply date was asked for."; return; }

      const left = due - Date.now();
      if (left < 0) {
        const over = Math.floor(-left / 86400000);
        card.classList.add("replycard--late");
        state_.innerHTML = `<b>No reply.</b> The date we asked for passed ${
          over < 1 ? "today" : `${over} day${over === 1 ? "" : "s"} ago`}.`;
        return;
      }
      const d = Math.floor(left / 86400000);
      const h = Math.floor((left % 86400000) / 3600000);
      state_.innerHTML = `<b>${d > 0 ? `${d} day${d === 1 ? "" : "s"}` : `${h} hour${
        h === 1 ? "" : "s"}`} left</b> to the date we asked for a reply by.`;
    };

    box.append(card);
    /* Once a minute. A second hand belongs on the letters page, not here. */
    const stop = tickWhileOnPage(card, tick, 60000);

    /* Only while there is still nothing back. The moment a question is marked
       replied in the workbench this stops being true, and a card that has to
       be remembered is a card that goes stale. */
    db.publishedQuestions().then((qs) => {
      if (qs.length && qs.some((q) => q.replied_at || q.answered_at)) {
        stop();
        card.remove();
      }
    }).catch(() => {});
  }).catch((err) => { console.warn("The reply card did not render:", err); });

  return box;
}

function replyClock(L) {
  const letters = lettersOf(L).filter((x) => x.sentAt);
  if (!letters.length) return null;

  const sent = letters.map((x) => new Date(x.sentAt).getTime()).sort((a, b) => a - b);
  const first = sent[0];

  /* The earliest date asked for across the letters, whether or not it has
     passed. replyDue() only returns ones still ahead, which is right for the
     home page and useless the day after a deadline. */
  const dates = letters.map((x) => x.replyBy).filter(Boolean).sort();
  const dueISO = dates[0] || null;
  /* End of the day asked for, not the start of it: a reply at five in the
     afternoon on the fourth is not late. */
  const due = dueISO ? new Date(`${dueISO}T23:59:59+01:00`).getTime() : null;

  const box = el(`<div class="clock"></div>`);

  const head = el(`
    <div class="clock__head">
      <span class="clock__label"></span>
      <span class="clock__big"></span>
      <span class="clock__sub"></span>
    </div>`);
  box.append(head);

  /* The track runs from the first letter to the deadline, with a mark for each
     letter and one for now. */
  const track = el(`
    <div class="clock__track" role="img">
      <div class="clock__fill"></div>
      <div class="clock__marks"></div>
      <div class="clock__now"></div>
    </div>`);
  box.append(track);

  const ends = el(`<div class="clock__ends"></div>`);
  box.append(ends);

  const marks = $(".clock__marks", track);
  letters.forEach((x) => {
    const t = new Date(x.sentAt).getTime();
    const at = due && due > first ? ((t - first) / (due - first)) * 100 : 0;
    marks.append(el(`
      <span class="clock__mark" style="left:${Math.max(0, Math.min(100, at))}%"
        title="${esc(x.sentWords || "")}"></span>`));
  });

  const label = $(".clock__label", head);
  const big = $(".clock__big", head);
  const sub = $(".clock__sub", head);
  const fill = $(".clock__fill", track);
  const now = $(".clock__now", track);

  const two = (n) => String(n).padStart(2, "0");

  const tick = () => {
    const t = Date.now();

    if (!due) {
      const days = Math.floor((t - first) / 86400000);
      label.textContent = "Since we wrote";
      big.textContent = `${days} day${days === 1 ? "" : "s"}`;
      sub.textContent = "No reply date was asked for on this one.";
      fill.style.width = "100%";
      return;
    }

    const left = due - t;
    const late = left < 0;
    const span = Math.abs(late ? t - due : left);

    const d = Math.floor(span / 86400000);
    const h = Math.floor((span % 86400000) / 3600000);
    const m = Math.floor((span % 3600000) / 60000);
    const sec = Math.floor((span % 60000) / 1000);

    box.classList.toggle("clock--late", late);
    label.textContent = late ? "No reply, and the date has passed" : "Time left to reply";
    big.innerHTML = `${d}<small>d</small> <span class="clock__hms">${
      two(h)}:${two(m)}:${two(sec)}</span>`;
    sub.textContent = `We asked for a reply by ${fmtDate(dueISO)}.`;

    const pct = late ? 100 : Math.max(0, Math.min(100, ((t - first) / (due - first)) * 100));
    fill.style.width = pct + "%";
    now.style.left = pct + "%";
  };

  ends.append(el(`<span>${esc(fmtDate(new Date(first).toISOString().slice(0, 10)))}</span>`));
  ends.append(el(`<span>${dueISO ? esc(fmtDate(dueISO)) : ""}</span>`));

  /* Whether anything has come back, worked out rather than typed. A sentence
     saying "no reply yet" is true until the day it is not, and on that day
     nobody remembers to change it. This reads the questions: mark one replied
     or answered in the workbench and this line changes itself. */
  const said = el(`<p class="clock__said">Checking&hellip;</p>`);
  box.append(said);
  db.publishedQuestions().then((qs) => {
    const replied = qs.filter((q) => q.replied_at || q.answered_at);
    const answered = qs.filter((q) => q.answered_at);
    if (!qs.length) { said.remove(); return; }
    if (!replied.length) {
      said.innerHTML = `<b>As of now, no response to either letter.</b> Nothing has come back on
        any of the ${qs.length} questions.`;
      return;
    }
    said.classList.add("clock__said--some");
    said.innerHTML = `The club has come back on <b>${replied.length} of ${qs.length}</b>
      question${qs.length === 1 ? "" : "s"}${
      answered.length ? `, and answered <b>${answered.length}</b>` : ", without answering any"}.`;
  }).catch(() => { said.remove(); });

  /* Every render of this page builds a new clock and drops the old one, so the
     old timer has to stop when its node goes. tickWhileOnPage owns that. */
  tickWhileOnPage(box, tick, 1000);
  return box;
}

function openLetterSection({ openNewest = false } = {}) {
  /* Given an id so the letter page and the report can both anchor to it. */
  const box = el(`<div id="letter"></div>`);
  loadLetter().then((L) => {
    const letters = lettersOf(L);
    if (!letters.length) return;

    box.append(el(`<h2 class="section-title">${
      letters.length > 1 ? "The letters we have sent" : "The letter we sent"}</h2>`));

    if (letters.length > 1) {
      box.append(el(`<p class="hint">Newest first. Each one is reproduced exactly as it was
        sent, and none of them has been edited since.</p>`));
    }

    letters.forEach((x, i) => box.append(
      oneLetter(x, i === 0 && letters.length > 1, openNewest && i === 0)));
  }).catch(() => { /* the report stands on its own without it */ });
  return box;
}

function oneLetter(L, newest, openByDefault = false) {
  const wrap = el(`<div class="letter-block"></div>`);

  if (L.title) {
    wrap.append(el(`<div class="letter-head">
      ${newest ? `<span class="pill pill--gold">Latest</span>` : ""}
      <b>${esc(L.title)}</b>
      ${L.subject ? `<span>${esc(L.subject)}</span>` : ""}
    </div>`));
  }

  /* Who it went to and when, in the open, before anybody has to unfold
     anything. A letter published without its address and its timestamp is an
     article about a letter. */
  wrap.append(el(`
    <div class="card sent-slip">
      <div class="sent-slip__row"><span>To</span><b>${esc(L.to || "the club")}</b></div>
      <div class="sent-slip__row"><span>Sent</span><b>${esc(L.sentWords)}</b></div>
      <div class="sent-slip__row"><span>Reply asked for by</span><b>${
        L.replyBy ? esc(fmtDate(L.replyBy)) : "No date set"}</b></div>
      ${(() => {
        /* How long it has gone unanswered, which is the number that matters.
           Counted from the day it was sent, not from the reply date. */
        const days = Math.floor((Date.now() - new Date(L.sentAt).getTime()) / 86400000);
        if (!Number.isFinite(days) || days < 1) return "";
        return `<div class="sent-slip__row"><span>Unanswered for</span><b>${days} day${
          days === 1 ? "" : "s"}</b></div>`;
      })()}
    </div>`));

  wrap.append(foldable(`Read it in full, as sent on ${L.sentWords}`, () => {
    const card = el(`<div class="card letter"></div>`);
    L.body.forEach((b) => {
      if (b.t === "h") {
        card.append(el(`<h3 class="letter__h">${esc(b.x)}</h3>`));
      } else if (b.t === "p") {
        card.append(el(`<p class="letter__p">${esc(b.x)}</p>`));
      } else if (b.t === "list") {
        card.append(el(`<ul class="letter__list">${
          b.x.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`));
      } else if (b.t === "quotes") {
        b.x.forEach((q) => card.append(el(`<blockquote class="letter__q">${esc(q)}</blockquote>`)));
      } else if (b.t === "ref") {
        card.append(el(`<p class="letter__ref">${esc(b.x)}</p>`));
      } else if (b.t === "sign") {
        card.append(el(`<p class="letter__sign">${b.x.map(esc).join("<br>")}</p>`));
      }
    });
    if (L.note) card.append(el(`<p class="note" style="margin-top:14px">${esc(L.note)}</p>`));
    return card;
  }, { open: openByDefault }));

  return wrap;
}

/**
 * The questions put to the club, and where each one stands.
 *
 * Lives on the consultation report and on the letters page. The letters page
 * had the letters and nothing else: two collapsed folds and nineteen hundred
 * characters, which is a poor thing to land on when the whole fanbase is being
 * pointed at it from the home page.
 */
function questionsSection() {
/* The merged questions. Ninety-five raw questions would be a wall nobody
   reads and a club answers none of; a dozen with a count against each is
   the thing that is hard to leave alone. */
const qbox = el(`<div></div>`);
db.publishedQuestions().then((qs) => {
  state.hasFinalGroups = qs.length > 0;
  if (!qs.length) return;
  /* Two lists, not one numbered run. The ten came out of the consultation
     and carry a count of how many supporters asked; the working group's
     did not, and a skim reader taking all twelve as coming from 199
     supporters is exactly the misreading this page cannot afford. */
  const fromFans = qs.filter((q) => q.origin !== "working_group");
  const fromGroup = qs.filter((q) => q.origin === "working_group");

  qbox.append(el(`<h2 class="section-title">What supporters want answered</h2>`));
  qbox.append(el(`<p class="hint">A question counts as answered when the club has written back
    with an answer to it. A reply that does not answer it is recorded as a reply and the
    question keeps running, and something quietly being put right is not the same as being
    told.</p>`));

  /* The commitment, stated before the list rather than under it. Once the
     email has gone the promise becomes a date, because a page still
     promising to send something a week later reads as a page nobody is
     keeping up. */
  /* Taken from the first question, which was fine while every question went
     in one email. Two more went on 24 August, so a single date here would
     have told supporters something untrue about when the club got them. */
  const sentDays = [...new Set(fromFans.filter((q) => q.asked_at)
    .map((q) => String(q.asked_at).slice(0, 10)))].sort();
  const sentAt = sentDays[0] || null;
  const alsoLater = sentDays.length > 1 ? sentDays[sentDays.length - 1] : null;
  qbox.append(el(`
    <div class="card pledge">
      <p class="club-overview" style="margin:0">${sentAt
        ? `These ${fromFans.length} questions were put to Kettering Town FC in writing, word for
           word as they appear here, along with every question that did not fall under one of
           them. ${alsoLater
             ? `Most went on <b>${esc(fmtDate(sentAt))}</b> and the rest on
                <b>${esc(fmtDate(alsoLater))}</b>; each one below says which.`
             : `They went on <b>${esc(fmtDate(sentAt))}</b>.`} Each one below shows how long it
           has gone without an answer.`
        : `These ${fromFans.length} questions will be put to Kettering Town FC in writing
           <b>within 24 hours</b>, word for word as they appear here, along with every question
           that did not fall under one of them. Nothing is softened, and nothing is left out.
           Each one below will then show how long it has gone without an answer.`}</p>
    </div>`));

  /* `offset` continues the numbering rather than restarting it: these were
     sent to the club as two more on top of the ten, and numbering them 1
     and 2 again would lose that. `attributed` is off inside the working
     group's own block, where the heading above already says whose they
     are and repeating it on every line is noise. */
  const questionCard = (list, { offset = 0, attributed = true } = {}) => {
  const card = el(`<div class="card"></div>`);
  list.forEach((q, i) => {
    const days = q.asked_at && !q.answered_at
      ? Math.floor((Date.now() - new Date(q.asked_at).getTime()) / 86400000) : null;
    const item = el(`
      <div class="qitem">
        <span class="qitem__n">${offset + i + 1}</span>
        <div>
          <p>${esc(q.label)}</p>
          <p class="hint">${attributed ? `<b>${
            q.origin === "working_group"
              ? "Asked by the working group"
              : `Asked by ${q.asked_by} supporter${q.asked_by === 1 ? "" : "s"}`}</b>` : ""}${
            q.answered_at
              ? `${attributed ? " · " : ""}<b>Answered ${
                  esc(fmtDate(String(q.answered_at).slice(0, 10)))}.</b>` :
            q.replied_at
              /* Written back, but not answered. Left running, because it
                 is still outstanding, and said plainly, because a reply is
                 not nothing and pretending otherwise is unfair to them. */
              ? `${attributed ? " · " : ""}Replied ${
                  esc(fmtDate(String(q.replied_at).slice(0, 10)))} · <b>Not answered${
                  days !== null && days >= 1
                    ? `, ${days} day${days === 1 ? "" : "s"} since we asked` : ""
                }.</b>` :
            days !== null ? `${attributed ? " · " : ""}Sent ${
              esc(fmtDate(String(q.asked_at).slice(0, 10)))} · <b>${days < 1
                ? "Awaiting a reply."
                : `Awaiting a reply, ${days} day${days === 1 ? "" : "s"} so far.`}</b>` :
            `${attributed ? " · " : ""}To be sent to the club.`}</p>
          ${q.reply_note ? `<p class="qitem__reply">${esc(q.reply_note)}</p>` : ""}

          ${(q.samples || []).length ? `
            <details class="qitem__src">
              <summary>See how ${q.samples.length === 1 ? "one supporter" :
                `${q.samples.length} supporters`} put it${
                q.asked_by > q.samples.length ? `, of the ${q.asked_by} who asked` : ""
              }</summary>
              ${q.samples.map((w) => `<p>${esc(w)}</p>`).join("")}
              ${q.asked_by > q.samples.length ? `<p class="hint">The other ${
                q.asked_by - q.samples.length
              } who asked this did not tick the box saying we could publish their wording. They
              are still counted above, and their question still went to the club.</p>` : ""}
            </details>` : `
            ${q.origin === "working_group" ? "" : `
              <p class="hint">Nobody who asked this ticked the box saying we could publish
              their wording, so only the count is shown.</p>`}`}
        </div>
      </div>`);
    card.append(item);
  });
  return card;
  };

  const fanCard = questionCard(fromFans);
  fanCard.append(el(`<p class="hint">Where several supporters asked the same thing in different
    words, we merged it and said how many asked. The wording is ours; theirs is under each
    one.</p>`));
  qbox.append(fanCard);

  /* Below the survey's questions, under its own heading, so nothing here
     can be read as something 199 supporters asked for. */
  if (fromGroup.length) {
    qbox.append(el(`<h2 class="section-title">Also asked, by the working group</h2>`));
    qbox.append(el(`
      <div class="card pledge">
        <p class="club-overview" style="margin:0">${fromGroup.length === 1
          ? "This question did not"
          : `These ${fromGroup.length} questions did not`} come out of the consultation.
          ${fromGroup.length === 1 ? "It was" : "They were"} agreed by the KTFCSA working group
          and sent to the club alongside the others, and ${
          fromGroup.length === 1 ? "it is" : "they are"} counted here for the same reason:
          so the wait for an answer is on the record.</p>
      </div>`));
    qbox.append(questionCard(fromGroup, { offset: fromFans.length, attributed: false }));
  }
}).catch(() => {});
return qbox;
}

function consultResults() {
  const box = el(`<div><div class="skeleton" style="height:320px"></div></div>`);

  db.consultationResults().then((r) => {
    box.replaceChildren();
    if (!r?.summary || !r.summary.responses) {
      box.append(el(`<div class="empty"><b>Nothing to show yet</b>The results go up once the
        consultation has closed.</div>`));
      return;
    }
    const s = r.summary;
    const pct = (n) => Math.round((n / s.responses) * 100);
    const find = (kind, choice) =>
      r.choices.find((c) => c.kind === kind && c.choice === choice)?.people || 0;
    const conf = Object.fromEntries(r.confidence.map((c) => [c.score, c.people]));
    const low = (conf[1] || 0) + (conf[2] || 0) + (conf[3] || 0);
    const high = (conf[8] || 0) + (conf[9] || 0) + (conf[10] || 0);

    const save = el(`
      <div class="btn-row btn-row--end no-print" style="margin-bottom:12px">
        <button class="btn btn--sm btn--ghost">Save as PDF</button>
      </div>`);
    save.querySelector("button").addEventListener("click", () => {
      const before = document.title;
      document.title = `KTFCSA fan consultation, August 2026`;
      window.addEventListener("afterprint", () => { document.title = before; }, { once: true });
      window.print();
    });
    box.append(save);

    /* ------------------------------------------------ what this is, first */
    box.append(el(`
      <div class="card">
        <p class="club-overview"><b class="subhead">What this is</b> An independent consultation
        run by the Kettering Town FC Supporters' Association, asking supporters what they make of
        the way the club is being run. It is not the club's survey. The Association is not funded
        by the club and speaks only for the supporters who answered.</p>
        <p class="club-overview" style="margin-top:12px"><b class="subhead">When and how</b> It ran
        from Monday 17 August to midday on Friday 21 August 2026, five days, through this app.
        Anyone could answer, with or without an account, one response per device. Nine questions,
        seven of them multiple choice and two free text. Nobody was paid, prompted or selected.
        Supporters found it through the app, social media and word of mouth.</p>
        <p class="club-overview" style="margin-top:12px"><b class="subhead">What is published</b>
        Every number below is the whole of what was collected, not a selection. Free-text answers
        are published only where the supporter ticked a box allowing it and a volunteer approved it,
        which is why some questions show more people asking than wordings shown.</p>
      </div>`));

    /* ----------------------------------------------------- at a glance */
    box.append(el(`<h2 class="section-title">At a glance</h2>`));
    box.append(el(`
      <div class="card">
        <div class="info-grid info-grid--4">
          <div class="info"><div class="info__label">Responses</div><div class="info__value" style="color:var(--accent)">${s.responses}</div></div>
          <div class="info"><div class="info__label">Confidence</div><div class="info__value">${s.confidence_avg}<span style="font-size:0.875rem;color:var(--text-3)">/10</span></div></div>
          <div class="info"><div class="info__label">Wrong direction</div><div class="info__value">${pct(s.direction_wrong)}%</div></div>
          <div class="info"><div class="info__label">Would attend a meeting</div><div class="info__value">${s.meeting_any}</div></div>
        </div>
        <p class="hint">In May 2026 the same confidence question drew <b>${MAY.confidence}/10</b>
        from ${MAY.responses} supporters. It is now <b>${s.confidence_avg}/10</b> from
        ${s.responses}. ${s.from_members} answered while signed in to an account.</p>
      </div>`));

    /* --------------------------------------------------- the overview */
    box.append(el(`<h2 class="section-title">The overview</h2>`));
    box.append(el(`
      <div class="card">
        <p class="club-overview">${s.responses} supporters answered in five days. What they
        describe is consistent rather than mixed: <b>${s.direction_wrong} of ${s.responses}</b> say
        the club is heading in the wrong direction, and average confidence in how it is being run is
        <b>${s.confidence_avg} out of ten</b> against ${MAY.confidence} when the same question was
        asked in May. <b>${conf[1] || 0} people</b> gave the lowest score available, and
        ${low} of ${s.responses} scored three or less.</p>

        <p class="club-overview" style="margin-top:12px">The concerns are unusually concentrated.
        Volunteers leaving is named by <b>${find("concern", "volunteers")}</b> of ${s.responses},
        the club's finances by ${find("concern", "finance")} and communication by
        ${find("concern", "communication")}. Those three sit clear of everything else, and they are
        the same three that dominate what supporters asked the club: of ${s.questions_asked}
        questions submitted, the largest groups concern the sale of the club, why so many volunteers
        have left, and where the money has gone.</p>

        <p class="club-overview" style="margin-top:12px">Two findings cut against the general mood
        and are worth stating plainly. The team itself is the most praised thing about the club,
        named by <b>${find("positive", "team")}</b> of ${s.responses}. Supporters are drawing a line
        between the side on the pitch and the way the club is run. And the Supporters' Trust,
        whose role several questions raised, is rated good or very good by more supporters than rate
        it poor or very poor.</p>

        <p class="club-overview" style="margin-top:12px">On what supporters would support, nothing
        commands a clear majority: banners lead on ${find("action", "banners")} of ${s.responses}, a
        public letter ${find("action", "letter")}, a boycott ${find("action", "boycott")}, and
        ${find("action", "none")} would support none of it. The strongest single mandate here is not
        for protest but for organisation: <b>${s.meeting_any} of ${s.responses}</b> would come to a
        first meeting of the Association, ${s.meeting_in_person} of them in person.</p>

        <p class="note" style="margin-top:14px">This summary was written by an AI tool from the
        figures on this page and the questions supporters submitted, and checked by a volunteer
        before publication. It was given the numbers, not a steer. It does not draw on the
        free-text comments, which are published below in supporters' own words.</p>
      </div>`));

    /* --------------------------------------------------- confidence */
    box.append(el(`<h2 class="section-title">Confidence in how the club is run</h2>`));
    const cbox = el(`<div class="card"></div>`);
    const maxConf = Math.max(...r.confidence.map((c) => c.people), 1);
    cbox.append(el(`
      <div>${Array.from({ length: 10 }, (_, i) => {
        const n = conf[i + 1] || 0;
        return `<div class="dist">
          <span class="dist__key">${i + 1}</span>
          <span class="dist__bar"><span class="dist__fill" style="width:${Math.round((n / maxConf) * 100)}%"></span></span>
          <span class="dist__n">${n}</span>
        </div>`;
      }).join("")}</div>`));
    cbox.append(el(`<p class="hint">The average is ${s.confidence_avg}, but the shape matters more
      than the average: <b>${low} of ${s.responses}</b> scored three or less, and
      <b>${high}</b> scored eight or more. This is not a fanbase split down the middle.</p>`));
    box.append(cbox);

    /* --------------------------------------------------- direction */
    box.append(el(`<h2 class="section-title">The direction of the club</h2>`));
    const dbox = el(`<div class="card"></div>`);
    dbox.append(verdictBar("Is the club heading in the right direction?", {
      "very-poor": s.direction_wrong, ok: s.direction_unsure, "very-good": s.direction_right,
    }));
    dbox.append(el(`<p class="hint">${s.direction_wrong} say wrong direction,
      ${s.direction_right} say right, ${s.direction_unsure} are not sure.</p>`));
    box.append(dbox);

    /* --------------------------------------------- representation */
    box.append(el(`<h2 class="section-title">Who supporters feel represented by</h2>`));
    const rbox = el(`<div class="card"></div>`);
    const byBody = {};
    r.representation.forEach((x) => {
      (byBody[x.body] ||= {})[x.verdict] = x.people;
    });
    const bodyNames = {
      ownership: "Club ownership", board: "The club board (president, directors, secretary)",
      trust: "The Supporters' Trust", sponsors: "Club partners and sponsors",
    };
    Object.entries(bodyNames).forEach(([k, name]) => {
      if (byBody[k]) rbox.append(verdictBar(name, byBody[k]));
    });
    rbox.append(el(`<p class="hint">Supporters were asked how well each body represents them, on a
      five-point scale with a separate "not sure". The Trust is the only one of the four rated more
      positively than negatively.</p>`));
    box.append(rbox);

    /* Concerns and positives together rather than as two separate lists. The
       contrast is the finding: supporters are hard on how the club is run and
       warm about the club itself, and side by side that reads in one glance. */
    const asMap = (list) => Object.fromEntries(list);
    const pickRows = (kind) =>
      r.choices.filter((c) => c.kind === kind).sort((a, b) => b.people - a.people);

    box.append(el(`<h2 class="section-title">What worries supporters, and what they would defend</h2>`));
    const pair = el(`<div class="pair"></div>`);
    const worry = el(`<div class="card pair__side"><div class="pair__head">Concerns</div></div>`);
    worry.append(rankedBars(pickRows("concern"), asMap(CONSULT_CONCERNS), s.responses));
    const like = el(`<div class="card pair__side"><div class="pair__head">Would defend</div></div>`);
    like.append(rankedBars(pickRows("positive"), asMap(CONSULT_POSITIVES), s.responses));
    pair.append(worry, like);
    box.append(pair);
    box.append(el(`<p class="hint" style="margin-top:-4px">Supporters could pick as many as applied
      in each. The gap between the two columns is the point: the criticism is aimed at how the club
      is run, not at the club.</p>`));

    box.append(el(`<h2 class="section-title">What supporters would support</h2>`));
    const abox = el(`<div class="card"></div>`);
    abox.append(rankedBars(pickRows("action"), asMap(CONSULT_ACTIONS), s.responses));
    abox.append(el(`<p class="hint">The Association is reporting what supporters told us they would
      be behind. It is not calling for any of it, and nothing here was proposed by us: every option
      came from what supporters were already saying before the consultation opened.</p>`));
    box.append(abox);

    /* The one constructive number in the whole exercise. Put near the top of
       the findings on purpose: a mood is a mood, a room full of people is a
       supporters' association. */
    if (s.meeting_any) {
      box.append(el(`<h2 class="section-title">The first meeting</h2>`));
      box.append(el(`
        <div class="card">
          <div class="info-grid info-grid--3">
            <div class="info"><div class="info__label">Would come</div><div class="info__value" style="color:var(--accent)">${s.meeting_any}</div></div>
            <div class="info"><div class="info__label">In a room</div><div class="info__value">${s.meeting_in_person}</div></div>
            <div class="info"><div class="info__label">Online</div><div class="info__value">${s.meeting_online}</div></div>
          </div>
          <div class="hint">${s.meeting_updates} more asked to be kept posted without being able to
          come. Nothing is booked yet; this is what we asked supporters in order to work out
          whether to arrange one, and whether it needs to be in a room, online, or both.</div>
        </div>`));
    }

    box.append(questionsSection());

    /* Directly under the questions, because it is the covering note to them. */
    box.append(openLetterSection());

    /* The questions, numbered, with how long each has gone unanswered. That
       last column is the point of the exercise. */
    /* Individually approved questions, shown only until the merged list exists.
       Once groups are final the block above says it better, and both together
       would ask the club the same thing twice. */
    const questions = r.published.filter((p) => p.question);
    if (questions.length && !state.hasFinalGroups) {
      box.append(el(`<h2 class="section-title">Questions put to the club</h2>`));
      const qc = el(`<div class="card"></div>`);
      questions.forEach((q, i) => {
        const days = q.asked_at && !q.answered_at
          ? Math.floor((Date.now() - new Date(q.asked_at).getTime()) / 86400000) : null;
        qc.append(el(`
          <div class="qitem">
            <span class="qitem__n">${i + 1}</span>
            <div>
              <p>${esc(q.question)}</p>
              <p class="hint">${q.attribution ? `Asked by ${esc(q.attribution)}. ` : ""}${
                q.answered_at ? "Answered." :
                days !== null ? `<b>Awaiting a reply, ${days} day${days === 1 ? "" : "s"} so far.</b>` :
                "To be sent to the club."}</p>
            </div>
          </div>`));
      });
      box.append(qc);
    }

    /* Supporters' own words. Split by what they are about rather than run as one
       column, because a wall of criticism reads as a pile-on while the same
       comments beside what people would defend read as a fanbase. Each carries
       the confidence score it came with, which stops a quote being detachable
       from the person's overall view. */
    const notes = r.published.filter((p) => p.concern_note || p.positive_note);
    if (notes.length) {
      box.append(el(`<h2 class="section-title">In supporters' own words</h2>`));

      const quoteCard = (text, kind, row) => el(`
        <blockquote class="quote quote--${kind}">
          <p>${esc(text)}</p>
          <footer>
            ${row.attribution ? `<cite>${esc(row.attribution)}</cite>` : `<cite>Anonymous</cite>`}
            ${typeof row.confidence === "number"
              ? `<span class="quote__score" title="Their confidence in how the club is run">${
                  row.confidence}/10</span>` : ""}
          </footer>
        </blockquote>`);

      const worries = notes.filter((n) => n.concern_note);
      const likes = notes.filter((n) => n.positive_note);

      if (likes.length) {
        box.append(el(`<div class="quotes__head">What supporters would defend
          <span>${likes.length}</span></div>`));
        const g1 = el(`<div class="quotes"></div>`);
        likes.forEach((n) => g1.append(quoteCard(n.positive_note, "good", n)));
        box.append(g1);
      }
      if (worries.length) {
        box.append(el(`<div class="quotes__head">What worries them
          <span>${worries.length}</span></div>`));
        const g2 = el(`<div class="quotes"></div>`);
        worries.forEach((n) => g2.append(quoteCard(n.concern_note, "bad", n)));
        box.append(g2);
      }

      box.append(el(`<p class="hint">Published with permission and read by a volunteer first. Most
        supporters did not write for publication, so these are a fraction of what was said and are
        not a sample of anything: they are the ones we were allowed to print.</p>`));
    }

    /* The first thing anybody attacks about a fan survey is the method, so it
       is answered before it is asked. */
    box.append(el(`<h2 class="section-title">How this was done</h2>`));
    box.append(el(`
      <div class="card">
        <p class="club-overview">The multiple choice answers are reported
        exactly as given, including the full spread of confidence scores rather than only the
        average. Everything anybody wrote was read by a volunteer before publication, and appears
        only where the supporter ticked the box saying it could. Questions for the club were
        merged where several people asked the same thing: a computer suggested the groupings, a
        person decided them, and the wording of each merged question is the Association's, with
        supporters' own wording shown underneath.</p>
        <p class="club-overview" style="margin-top:12px">This is a survey of supporters who chose
        to answer, not a poll of a representative sample, and we make no claim otherwise. Raw
        responses are not published and were not shared with the club.</p>
      </div>`));

  }).catch(() => {
    box.replaceChildren();
    box.append(el(`<div class="empty"><b>Results unavailable</b>Please try again shortly.</div>`));
  });

  return box;
}

/**
 * A ticker across the top of the landing page, for the five days it runs.
 *
 * Deliberately the only thing on the site that moves. It reads once and stops
 * rather than scrolling for ever, because a permanent crawl is an advert and
 * this is a deadline. Honours prefers-reduced-motion by simply sitting still.
 */
/**
 * Has the report been published?
 *
 * Asked once and remembered, so a page can tell "closed" from "published"
 * without a round trip on every render, and only once the backend exists:
 * asked earlier, the store answers "not published" because there is nothing to
 * ask, and that answer used to be cached for the life of the page. Anyone
 * whose first paint beat the connection saw "the results are being checked"
 * and never stopped seeing it.
 *
 * The home page ticker needs this as much as the consultation page does, which
 * is why it is no longer buried inside viewConsult.
 */
function askIfPublished() {
  if (state.publishedPromise || !db.isOnline()) return;
  state.publishedPromise = db.consultationPublished().then((p) => {
    const on = Boolean(p?.results_public);
    if (on !== state.resultsPublic) { state.resultsPublic = on; render(); }
    return p;
  }).catch(() => {
    state.publishedPromise = null;   /* a failed ask is not an answer */
    return null;
  });
}

function consultTicker() {
  askIfPublished();
  /* Second act. The consultation is closed and the report and the letter are
     out, which is the thing worth pointing at now: a survey nobody can answer
     any more is not news, and a letter to the club with a reply date on it is.
     It goes straight to the letter rather than the top of a long report. */
  if (consultState() !== "open") {
    if (!state.resultsPublic) return null;
    /* The reply date lives in the letter file, which the home page has no
       other reason to fetch. Pulled once, and the line reads fine without it
       in the meantime rather than holding up the paint. */
    if (!state.letter) loadLetter().then((r) => { if (r) render(); }).catch(() => {});
    const many = lettersOf(state.letter).length;
    const due = replyDue(state.letter);
    const line = `Our open letter${many > 1 ? "s" : ""} to the club ${
      many > 1 ? "are" : "is"} published${
      due ? ` \u00B7 We have asked for a reply by ${fmtDate(due)}` : ""
    } \u00B7 Read what supporters said and what we put to them`;
    return el(`
      <button class="ticker ticker--letter" data-nav="letter"
        aria-label="Our open letter${many > 1 ? 's' : ''} to the club. ${esc(line)}">
        <span class="ticker__tag">Open letter${many > 1 ? "s" : ""}</span>
        <span class="ticker__track"><span class="ticker__line">${esc(line)}</span></span>
        <span class="ticker__go" aria-hidden="true">\u203A</span>
      </button>`);
  }
  if (db.hasAnswered()) return null;
  const line = `Independent fan consultation on how the club is being run · Open to every supporter, no account needed · Closes ${CLOSES_WORDS} · Have your say`;
  /* The running total is appended once it arrives rather than held for, so the
     ticker paints immediately and nobody waits on a network call to read it. */
  const withCount = (node) => {
    db.consultationResults().then((r) => {
      const n = r?.summary?.responses || 0;
      if (!n) return;
      const l = node.querySelector(".ticker__line");
      if (l) l.textContent = `${n} supporters have already had their say · ${line}`;
    }).catch(() => {});
    return node;
  };
  return withCount(el(`
    <button class="ticker" data-nav="consult" aria-label="Fan consultation. ${esc(line)}">
      <span class="ticker__tag">Now on</span>
      <span class="ticker__track"><span class="ticker__line">${esc(line)}</span></span>
      <span class="ticker__go" aria-hidden="true">›</span>
    </button>`));
}


/**
 * Where the price checker actually read each club's prices, so the link under
 * them goes to the page the figures came from rather than the club's front
 * door. Only a handful of clubs publish somewhere a script can read, so most
 * still fall back to the website.
 */
function ensurePriceSources() {
  if (!state.priceSourcePromise) {
    state.priceSourcePromise = readJSON("data/price-check.json").then((d) => {
      state.priceSources = Object.fromEntries(
        (d?.readable || []).filter((r) => r.club && r.source).map((r) => [r.club, r.source])
      );
      return state.priceSources;
    }).catch(() => ({}));
  }
  return state.priceSourcePromise;
}


/* ========================================================== memorial match

   The annual Sonics v Angry Birds match for the Dylan Cecil Memorial Fund,
   hosted by the club at Latimer Park.

   Written plainly and checked against the fund's own site and the trustees'
   own words rather than embroidered. Dylan's family read things written about
   him, and the least this page can do is get the facts right and stay out of
   the way.                                                                  */

const MEMORIAL = {
  date: "2026-08-23",
  kickoff: "14:30",
  charityNo: "1161669",
  site: "https://dylancecilmemorialfund.co.uk/",
  /* The organisers' poster. Everything that shows it degrades to the painted
     Angry Birds / Sonics band if the file is not there. */
  poster: "assets/img/memorial-poster.jpg",
};

/**
 * Wires up the poster images in a freshly built node.
 *
 * The app sends `script-src 'self'`, so inline onload/onerror attributes are
 * blocked outright — the handlers have to be attached here. Every use of the
 * poster degrades on its own: the hero drops back to the painted band, the
 * fixture-list thumbnail disappears, and the home card returns to its heart.
 * The page has to read properly whether or not the file is in the build.
 */
function wirePosters(node) {
  node.querySelectorAll("img[data-poster]").forEach((img) => {
    const kind = img.dataset.poster;
    const gone = () => {
      if (kind === "hero") img.closest(".poster")?.remove();
      else if (kind === "icon") { const p = img.parentElement; if (p) p.textContent = "\u{1F499}"; }
      else img.remove();
    };
    /* `complete` is true for an image that has not started loading at all,
       which is every image here: el() builds nodes inside a template, and
       nothing in that inert document fetches until it is put on the page. Only
       an image already in the document can be trusted to have settled. */
    if (document.contains(img) && img.complete) {
      if (!img.naturalWidth) gone();
      return;
    }
    img.addEventListener("error", gone, { once: true });
  });
  return node;
}

/** True until the end of the day the match is played on. */
const memorialUpcoming = () => londonToday() <= MEMORIAL.date;

function viewMemorial() {
  /* The match has been played. The page stays, because the fund does not stop
     when the game does and this is the only place on the site that explains
     what it is for. What changed is the emphasis: it led on a fixture to turn
     up to, and it now leads on a charity you can give to any week of the year. */
  const wrap = wirePosters(el(`
    <div>
      <div class="page-head page-head--airy">
        <h1>The Dylan Cecil Memorial Fund</h1>
        <p>A Kettering charity that sends families on holiday when they are going through the
           worst of it. The memorial match at Latimer Park is one of the reasons it can.</p>
      </div>

      <div class="card">
        <p class="club-overview"><b>The 2026 match has been played.</b> Angry Birds against the
        Sonics at Latimer Park on Sunday 23 August, and thank you to everybody who turned up,
        played, ran the gate or put something in a bucket. The fund takes donations all year
        round, and the match comes back next August.</p>
      </div>

      <h2 class="section-title">What the fund does</h2>
      <div class="card">
        <p class="club-overview">The Dylan Cecil Memorial Fund has been a registered charity since
        2014. It pays for holidays for families with children who have life-limiting illnesses, and
        for children who have been through the loss of someone close to them. Families are put
        forward by other people and other charities, and the trustees choose who is helped.</p>
        <p class="club-overview" style="margin-top:12px">It has arranged <b>32 holidays</b> so far.
        Five families were helped in 2025 and another five are already paid for or arranged for
        2026.</p>
        <p class="club-overview" style="margin-top:12px">The charity's own words for what that
        means are better than any of ours: <i>making memories that last forever</i>.</p>
      </div>

      <h2 class="section-title">Dylan</h2>
      <div class="card">
        <p class="memorial__dates">Dylan Cecil &middot; 29 April 2008 &ndash; 19 August 2012</p>
        <p class="club-overview">Dylan sadly passed away in August 2012. He was four years old,
        and he would have been eighteen this April.</p>
        <p class="club-overview" style="margin-top:12px">His grandad John and the Cecil family are
        well known around the club, and a lot of supporters will know them from around the ground.
        John wrote before this year's match that the family are left wondering what Dylan would be
        doing now, and that the one thing they are sure of is that he would have been following
        the Poppies with all his heart.</p>
        <p class="club-overview" style="margin-top:12px">Dylan's story is his family's to tell,
        and they tell it on the fund's own website:
        <a href="${MEMORIAL.site}dylan" target="_blank" rel="noopener">read about Dylan</a>.</p>
      </div>

      <h2 class="section-title">How to help, any time of year</h2>
      <div class="card">
        <p class="club-overview"><b>Give something.</b> Every holiday the fund pays for is
        somebody's family. The quickest way is to contact the fund directly through its own site.
        John Cecil is usually around the ground on a Saturday too, if you would rather hand
        something over in person.</p>
        <p class="club-overview" style="margin-top:12px"><b>Put an event on.</b> The match is the
        biggest thing in the fund's year, but it is not the only one, and the trustees will talk to
        anybody who wants to run something.</p>
        <p class="club-overview" style="margin-top:12px"><b>Come next August.</b> The memorial
        match is an annual fixture at Latimer Park. It will be back, and everyone is welcome
        whether you want to play or just stand and watch.</p>
      </div>

      <!-- The organisers' poster from this year's match, kept as a record of it.
           The painted band below is the fallback: if the file is missing the
           page still shows what the game was rather than a broken image box. -->
      <h2 class="section-title">This year's match</h2>
      <figure class="poster">
        <img src="${MEMORIAL.poster}" data-poster="hero" alt="Poster for the 2026 memorial match for Dylan Cecil: Angry Birds v Sonics, Sunday 23rd August, kick-off 2.30pm, Latimer Park, Kettering NN15 5PS. All proceeds to the Dylan Cecil Memorial Fund."
             loading="lazy" decoding="async">
      </figure>

      <div class="derby">
        <div class="derby__side derby__side--red"><span>Angry Birds</span></div>
        <div class="derby__vs">v</div>
        <div class="derby__side derby__side--blue"><span>Sonics</span></div>
      </div>
    </div>`));

  const links = el(`<div class="btn-row" style="margin-top:14px"></div>`);
  links.append(el(`
    <a class="btn btn--sm" href="${esc(MEMORIAL.site)}" target="_blank" rel="noopener">
      ${ICON.globe} The Dylan Cecil Memorial Fund</a>`));
  /* Only pages that exist. The fund's site has no /donate and no /events,
     whatever you would expect a charity site to have. */
  links.append(el(`
    <a class="btn btn--sm" href="${esc(MEMORIAL.site)}holidays" target="_blank" rel="noopener">
      The holidays it has paid for</a>`));
  links.append(el(`
    <a class="btn btn--sm btn--ghost" href="${esc(MEMORIAL.site)}contact-us" target="_blank" rel="noopener">
      Get in touch with the fund</a>`));
  links.append(el(`
    <a class="btn btn--sm btn--ghost" href="https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/${esc(MEMORIAL.charityNo)}"
       target="_blank" rel="noopener">Charity no. ${esc(MEMORIAL.charityNo)}</a>`));
  wrap.append(links);

  wrap.append(el(`
    <p class="note" style="margin-top:16px">The fund is run by Dylan's family and by people from
    the emergency services involved at the time. The trustees are John Cecil, Jon Dunham, founder
    Ian Jefferies and Deborah Newton. The match is hosted by Kettering Town FC. Details here are
    taken from the fund's own website and from the trustees, checked on
    ${esc(fmtDate(londonToday()))}.</p>`));
  return wrap;
}

/**
 * The row that appears in the fixture list. Marked as plainly as it can be:
 * it is not Kettering Town playing, it does not count towards anything, and
 * there is nothing to predict or rate.
 */
function memorialNotice() {
  const today = londonToday();
  const when = today === MEMORIAL.date ? "Today" : fmtDate(MEMORIAL.date);
  return wirePosters(el(`
    <button class="charity" data-nav="memorial">
      <span class="charity__flag">Charity match · not a Kettering Town fixture</span>
      <span class="charity__body">
        <img class="charity__poster" src="${MEMORIAL.poster}" data-poster="thumb" alt=""
             loading="lazy" decoding="async">
        <span class="charity__words">
          <span class="charity__title">Angry Birds v Sonics</span>
          <span class="charity__meta">${esc(when)} · 2.30pm · Latimer Park</span>
          <span class="charity__why">A memorial match for Dylan Cecil. Everyone welcome, and
            everything raised goes to his fund. No prediction, no ratings, nothing counted:
            just a game worth turning up to.</span>
          <span class="charity__go">Read about it ›</span>
        </span>
      </span>
    </button>`));
}

/** A card on the home page, for as long as the match is still to come. */
/**
 * A nudge towards the archive project on the home page.
 *
 * The page had one offer in three weeks, which is what happens to something
 * reachable only through More, Supporters, Archive Project. It is asking for
 * a free evening rather than money, and nobody was being asked.
 *
 * Stands down once enough people have offered, since at that point the project
 * needs starting rather than advertising.
 */
function archivePromo() {
  if (state.archiveOffers !== null && state.archiveOffers >= 12) return null;
  const b = el(`
    <button class="daily-promo daily-promo--archive" data-nav="heritage">
      <span class="daily-promo__icon">\uD83D\uDCFC</span>
      <span class="daily-promo__text">
        <strong>Got Poppies programmes in the loft?</strong>
        <span>We want to scan the club's history before any more of it goes in a skip</span>
      </span>
      <span class="daily-promo__go">Have a look</span>
    </button>`);
  return b;
}

function memorialPromo() {
  if (!memorialUpcoming()) return null;
  const today = londonToday();
  const when = today === MEMORIAL.date ? "Today, 2.30pm" : `${fmtDate(MEMORIAL.date, "short")}, 2.30pm`;
  return wirePosters(el(`
    <button class="daily-promo daily-promo--memorial" data-nav="memorial">
      <span class="daily-promo__icon daily-promo__icon--poster">
        <img src="${MEMORIAL.poster}" data-poster="icon" alt="" loading="lazy" decoding="async">
      </span>
      <span class="daily-promo__text">
        <strong>A memorial match for Dylan Cecil</strong>
        <span>Angry Birds v Sonics at Latimer Park · ${esc(when)} · everyone welcome</span>
      </span>
      <span class="daily-promo__go">Details</span>
    </button>`));
}

async function readJSON(path) {
  for (const init of [undefined, { cache: "no-store" }]) {
    try {
      const res = await fetch(path, init);
      if (res.ok) return await res.json();
    } catch {
      /* fall through to the retry, then give up quietly */
    }
  }
  return null;
}

async function loadLeague(force = false) {
  try {
    const res = await fetch(`data/league.json${force ? `?t=${Date.now()}` : ""}`, { cache: force ? "reload" : "default" });
    if (!res.ok) throw new Error(String(res.status));
    state.league = await res.json();
    /* The index folds this season in, so it has to be rebuilt if the archive
       got here first. Whichever order they land in, the answer is the same. */
    if (state.archive) state.archiveIndex = buildArchiveIndex(state.archive);
  } catch {
    state.league = null; /* the app falls back to the spreadsheet fixture list */
  }
}

async function loadAttendances() {
  if (state.attendances) return state.attendances;
  state.attendances = await readJSON("data/attendances.json");
  return state.attendances;
}

async function loadPubsNearby() {
  if (state.pubsNearby) return state.pubsNearby;
  state.pubsNearby = await readJSON("data/pubs-nearby.json");
  return state.pubsNearby;
}

async function loadParking() {
  if (state.parking) return state.parking;
  state.parking = await readJSON("data/parking.json");
  return state.parking;
}

async function loadGroundLinks() {
  if (state.groundLinks) return state.groundLinks;
  state.groundLinks = await readJSON("data/ground-links.json");
  return state.groundLinks;
}

async function loadLetter() {
  if (state.letter) return state.letter;
  state.letter = await readJSON("data/open-letter.json");
  return state.letter;
}

async function loadValueReview() {
  if (state.valueReview) return state.valueReview;
  state.valueReview = await readJSON("data/value-review.json");
  return state.valueReview;
}

async function loadAssociation() {
  if (state.association) return state.association;
  state.association = await readJSON("data/association.json");
  return state.association;
}

async function loadPodcast() {
  /* The feed allows direct requests, so try it first for the freshest list.
     The mirror in data/ is the backup. */
  try {
    const res = await fetch("https://anchor.fm/s/103d565e8/podcast/rss", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    state.podcast = parseFeed(await res.text());
    return;
  } catch {
    /* fall through to the mirror */
  }
  try {
    const res = await fetch("data/podcast.json");
    if (res.ok) state.podcast = await res.json();
  } catch {
    state.podcast = { episodes: [] };
  }
}

function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const text = (node, tag) => node.querySelector(tag)?.textContent?.trim() || "";
  const chan = doc.querySelector("channel");
  if (!chan) throw new Error("bad feed");
  const itunesImage = (node) =>
    [...node.children].find((c) => c.nodeName.toLowerCase() === "itunes:image")?.getAttribute("href") || "";
  const itunesTag = (node, name) =>
    [...node.children].find((c) => c.nodeName.toLowerCase() === `itunes:${name}`)?.textContent?.trim() || "";

  /* Feed descriptions are HTML, and the entities survive one decode pass.
     Strip the tags, then let the browser decode what is left. */
  const decoder = document.createElement("textarea");
  const strip = (s) => {
    decoder.innerHTML = String(s).replace(/<[^>]+>/g, " ");
    return decoder.value.replace(/\s+/g, " ").trim();
  };

  return {
    updated: new Date().toISOString(),
    feed: "https://anchor.fm/s/103d565e8/podcast/rss",
    title: text(chan, "title") || "The Poppycast",
    description: strip(text(chan, "description")),
    image: itunesImage(chan) || chan.querySelector("image url")?.textContent || "",
    link: text(chan, "link"),
    episodes: [...doc.querySelectorAll("item")].slice(0, 30).map((item) => {
      const published = text(item, "pubDate");
      return {
        title: text(item, "title"),
        published,
        publishedISO: published ? new Date(published).toISOString() : null,
        duration: itunesTag(item, "duration"),
        description: strip(text(item, "description")).slice(0, 600),
        audio: item.querySelector("enclosure")?.getAttribute("url") || "",
        link: text(item, "link"),
        image: itunesImage(item),
      };
    }),
  };
}

/* ==================================================================== boot */

function wireGlobalClicks() {
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      /* data-nav-id lets a plain nav button land on a section rather than the
         top of a page: the home ticker uses it to open the open letter. */
      go(nav.dataset.nav, nav.dataset.navId ? { id: nav.dataset.navId } : {});
      return;
    }
    /* Player names open their profile. Checked before the club handler because
       a player row can sit inside a card that also carries a club id. */
    const player = e.target.closest("[data-player]");
    if (player && player.dataset.player) {
      go("player", { id: encodeURIComponent(player.dataset.player) });
      return;
    }
    /* A name anywhere it appears opens that supporter's card. Checked before
       the club and match handlers, because a post can sit inside either. */
    const who = e.target.closest("[data-supporter]");
    if (who && who.dataset.supporter) {
      go("supporter", { id: who.dataset.supporter, from: state.view });
      return;
    }
    const match = e.target.closest("[data-match]");
    if (match && match.dataset.match) {
      go("match", { id: match.dataset.match });
      return;
    }
    const plan = e.target.closest("[data-plan]");
    if (plan && plan.dataset.plan) {
      go("plan", { id: plan.dataset.plan });
      return;
    }
    const club = e.target.closest("[data-club]");
    if (club && club.dataset.club) {
      go("club", { id: club.dataset.club, from: club.dataset.venue || "" });
    }
  });
}

/**
 * A band across the top of anything that is not the live site.
 *
 * Somebody testing needs to know which one they are looking at without
 * checking the address bar, and so does anybody reading a screenshot of it. It
 * says which database is behind the page, because that is the thing that
 * actually differs and the thing that matters if you are about to click
 * something destructive.
 */
function previewBanner() {
  const prod = CONFIG.productionHosts || [];
  if (!prod.length || prod.includes(location.hostname)) return;

  const onPreviewDb = Boolean(CONFIG.preview?.url && CONFIG.preview?.anonKey);
  const bar = el(`
    <div class="testbar${onPreviewDb ? "" : " testbar--warn"}">
      <b>Test site</b>
      <span>${onPreviewDb
        ? "Nothing here touches the live app. Post, break and undo whatever you like."
        : "Careful: no test database is configured, so this is writing to the live data."
      }</span>
      <a href="https://fans.ktfcsa.com/">Go to the live site</a>
    </div>`);
  document.body.prepend(bar);
  document.body.classList.add("has-testbar");
}

async function boot() {
  document.documentElement.dataset.theme = db.read("theme", "dark");
  applyTextSize();
  previewBanner();
  readHash();
  countView();
  wireGlobalClicks();

  /* Tags are cosmetic, so this never blocks a paint: the built-in list renders
     immediately and the database list replaces it a moment later. */
  loadTags().then(() => render()).catch(() => {});

  /* Outbound ground links. Small, and only affects a couple of buttons, so it
     never holds up a paint: the page renders without them and gains them a
     moment later. */
  Promise.all([loadGroundLinks(), loadParking(), loadPubsNearby(), loadAttendances()]).then(() => {
    if (state.view === "club" || state.view === "clubs") render();
  }).catch(() => {});

  /* Topics come from the database rather than a file, so they are pulled once
     the backend is up and again whenever the wall is opened. */
  db.topics().then((rows) => {
    state.topics = rows;
    if (state.view === "wall" || state.view === "topic") render();
  }).catch(() => { state.topics = []; });

  $("#account-btn").addEventListener("click", () => go("account"));
  /* Covers the back and forward buttons as well as the crest link in the
     header. pushState in go() does not fire this, so there is no double paint. */
  window.addEventListener("hashchange", () => {
    readHash();
    countView();
    render({ toTop: true });
  });

  /* Don't let the browser drop us halfway down a page we just rebuilt. */
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /* Lift the header once the page scrolls, so it reads as sitting above the
     content rather than painted on it. Passive listener, one class toggle. */
  const topbar = document.querySelector(".topbar");
  let lifted = false;
  const onScroll = () => {
    const should = window.scrollY > 4;
    if (should !== lifted) {
      lifted = should;
      topbar.classList.toggle("is-lifted", should);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  render({ toTop: true }); /* paint immediately with the bundled data */

  /* Fixtures and accounts are independent, so fetch them at the same time.
     Whichever lands first redraws. In the online setup the store also streams
     live updates, so a new car share or wall post appears without a refresh. */
  await Promise.all([
    loadClubInfo(),
    /* Redraw when this lands. On a quick connection it beats the first paint,
       but on a slow one the squad would otherwise sit there unrendered. */
    loadSquad().then(() => render()),
    loadLeague().then(() => render()),
    db
      .initStore({ change: () => render(), error: (message) => toast(message) })
      .then(() => render()),
  ]);

  /* A password reset link arrives as #access_token=...&type=recovery, which the
     router cannot read and quietly turns into the home page. It needs the
     backend, so it runs here rather than at the top of boot, and on its own
     rather than inside the Promise.all, where a rejection would have taken the
     rest of the boot down with it. */
  try {
    if (await db.consumeRecoveryLink()) {
      state.recovering = true;
      go("account");
    }
  } catch (err) {
    toast(err.message || "That reset link has expired. Ask for a new one.", "bad");
    go("account");
  }

  loadPodcast().then(() => {
    if (state.view === "podcast") render();
  });

  /* Nothing should fail in silence. Several places fire a promise and never
     look at it again, and a rejection there is invisible: the password reset
     told people nothing for exactly this reason. */
  window.addEventListener("unhandledrejection", (e) => {
    console.error("Unhandled rejection:", e.reason);
    const msg = e.reason?.message;
    if (msg) toast(msg, "bad");
  });

  /* keep the countdown honest without hammering the browser */
  setInterval(() => {
    if (state.view === "home") render();
  }, 60000);

  /* Registered from here rather than an inline tag, so the page can run under
     a strict content security policy. */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
