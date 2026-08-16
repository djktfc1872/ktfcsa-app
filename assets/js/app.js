/* Poppies Fan Companion - views and routing.
   Plain ES modules, no build step and no third party libraries. */

import { TEAMS, KTFC } from "./data.js";
import { CONFIG } from "./config.js";
import * as db from "./store.js";
import { QUIZ_EPOCH, londonToday, dayNumber } from "./quiz.js";

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
  /* A navigation arrow. The previous winding-route glyph collapsed into
     something like a helicopter at thirteen pixels. */
  route: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2.2a1 1 0 0 1 .92.6l7.2 16.8a1 1 0 0 1-1.33 1.3L12 17.83l-6.79 3.07a1 1 0 0 1-1.33-1.3l7.2-16.8a1 1 0 0 1 .92-.6Z"/></svg>`,
  pint: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M6 3h12l-1.2 17.1A2 2 0 0 1 14.8 22H9.2a2 2 0 0 1-2-1.9L6 3Zm2.2 2 .2 3h7.2l.2-3H8.2Z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15.7 15.7 0 0 0-1.1-5.2A8 8 0 0 1 18.9 11ZM12 4.2c.7 1 1.5 2.9 1.8 6.8h-3.6c.3-3.9 1.1-5.8 1.8-6.8ZM4.3 13h3c.1 2 .5 3.8 1 5.2A8 8 0 0 1 4.3 13Zm3-2h-3a8 8 0 0 1 4-5.2A15.7 15.7 0 0 0 7.3 11ZM12 19.8c-.7-1-1.5-2.9-1.8-6.8h3.6c-.3 3.9-1.1 5.8-1.8 6.8Zm2.8-1.6c.5-1.4.9-3.2 1-5.2h3a8 8 0 0 1-4 5.2Z"/></svg>`,
  poppy: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" class="ic-poppy"><g fill="#c8323f"><ellipse cx="12" cy="6.8" rx="4.9" ry="4.5"/><ellipse cx="17.2" cy="12" rx="4.5" ry="4.9"/><ellipse cx="12" cy="17.2" rx="4.9" ry="4.5"/><ellipse cx="6.8" cy="12" rx="4.5" ry="4.9"/></g><circle cx="12" cy="12" r="3.4" fill="#7d111b"/><circle cx="12" cy="12" r="1.9" fill="#1b1b1f"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2Zm0-8h-2V7h2Z"/></svg>`,
  car: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5Zm2.1 0h9.8l-1-3H8.1l-1 3ZM6.5 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>`,
};

/** Sits at the foot of every screen. Rendered by the shell, not by the views. */
function footer() {
  const { name, email } = CONFIG.credit;
  const year = new Date().getFullYear();

  return el(`
    <footer class="site-footer">
      <div class="site-footer__mark">${ICON.poppy}</div>
      <div class="site-footer__main">
        Website by ${esc(name)}. All rights reserved.
      </div>
      <a class="site-footer__mail" href="mailto:${esc(email)}">${esc(email)}</a>
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
  view: "fixtures",
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
  facts: null,    // researched club history, from data/club-facts.json
  bios: null,     // Darren Young's pen pics, from data/player-bios.json
  squad: null,    // the squad the club confirmed, from data/squad.json
  quiz: null,     // the Poppies Daily bank, fetched only when the game is opened
  quizById: null, // the same questions, keyed by id
  quizPromise: null,
  archive: null,      // past seasons, from data/archive.json
  archiveIndex: null, // that archive reduced to one row per player
  archivePromise: null,
  dailyTab: "play",
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
  fixtures: { label: "Fixtures", icon: "⚽", nav: "tab", group: "Matchday", render: viewFixtures },
  table: { label: "Table", icon: "🏆", nav: "tab", group: "Matchday", render: viewTable },
  predict: { label: "Prediction League", short: "Predict", icon: "🎯", nav: "tab", group: "Matchday", render: viewPredict },
  players: { label: "Players & Stats", icon: "⭐", nav: "more", group: "Matchday", render: viewPlayers },

  travel: { label: "Travel", icon: "🚌", nav: "more", group: "Away days", render: viewTravel },
  clubs: { label: "Away Guide", icon: "📖", nav: "more", group: "Away days", render: viewClubs },
  map: { label: "Grounds Map", icon: "🗺️", nav: "more", group: "Away days", render: viewMap },

  wall: { label: "Fan Wall", icon: "💬", nav: "tab", group: "Supporters", render: viewWall },
  podcast: { label: "Poppycast", icon: "🎙️", nav: "more", group: "Supporters", render: viewPodcast },
  videos: { label: "Club Videos", icon: "📺", nav: "more", group: "Supporters", render: viewVideos },
  poppies: { label: "Kettering Town", icon: ICON.poppy, nav: "more", group: "Supporters", render: viewPoppies },

  season: { label: "My Season", icon: "📈", nav: "more", group: "You", render: viewSeason },
  account: { label: "Account", icon: "👤", nav: "more", group: "You", render: viewAccount },
  feedback: { label: "Send Feedback", icon: "✉️", nav: "more", group: "You", render: viewFeedback },

  more: { label: "More", icon: "⋯", nav: "hidden", render: viewMore },
  club: { label: "Club", icon: "📍", nav: "hidden", render: viewClub },
  privacy: { label: "Your data", icon: "🔒", nav: "hidden", render: viewPrivacy },
  thread: { label: "Discussion", icon: "💬", nav: "hidden", render: viewThread },
  player: { label: "Player", icon: "⭐", nav: "hidden", render: viewPlayer },
  admin: { label: "Admin", icon: "🛠️", nav: "hidden", render: viewAdmin },
  match: { label: "Match", icon: "⚽", nav: "hidden", render: viewMatch },
  daily: { label: "Poppies Daily", short: "Daily", icon: "🌺", nav: "more", group: "Supporters", render: viewDaily },
  archive: { label: "Player Archive", icon: "📚", nav: "more", group: "Matchday", render: viewArchive },
};

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  const hash = params.id
    ? `#/${view}/${params.id}${params.from ? `/${params.from}` : ""}`
    : `#/${view}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  render({ toTop: true });
}

function readHash() {
  const [, view, id, from] = (location.hash || "#/fixtures").split("/");
  state.view = ROUTES[view] ? view : "fixtures";
  state.params = id
    ? { id: decodeURIComponent(id), from: from ? decodeURIComponent(from) : "" }
    : {};
}

/* =================================================================== chrome */

const routesWhere = (...kinds) => Object.entries(ROUTES).filter(([, r]) => kinds.includes(r.nav));

function renderNav() {
  let lastGroup = null;
  $("#sidebar").innerHTML = routesWhere("tab", "more")
    .map(([key, r]) => {
      const heading = r.group && r.group !== lastGroup ? `<div class="sidebar__group">${r.group}</div>` : "";
      lastGroup = r.group;
      return `${heading}
      <button class="sidebar__link ${state.view === key ? "is-active" : ""}" data-nav="${key}">
        <span class="ic" aria-hidden="true">${r.icon}</span>${r.label}
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
          <span class="ic" aria-hidden="true">${r.icon}</span>${r.short || r.label}
        </button>`)
      .join("") +
    `<button class="${onMore ? "is-active" : ""}" data-nav="more"
             aria-current="${onMore ? "page" : "false"}">
       <span class="ic" aria-hidden="true">⋯</span>More
     </button>`;

  const user = db.currentUser();
  $("#account-btn").innerHTML = user
    ? avatarHtml(user.name, user.id)
    : `<span class="btn btn--sm">Sign in</span>`;
}

function viewMore() {
  const wrap = el(`<div>
    <div class="page-head"><h1>More</h1><p>Everything else in the app.</p></div>
  </div>`);
  let seen = null;
  routesWhere("more").forEach(([key, r]) => {
    if (r.group && r.group !== seen) {
      wrap.append(el(`<h2 class="section-title">${esc(r.group)}</h2>`));
      seen = r.group;
    }
    wrap.append(el(`
      <button class="club-row" data-nav="${key}">
        <span style="font-size:19px;width:26px;text-align:center" aria-hidden="true">${r.icon}</span>
        <div style="flex:1;min-width:0"><div class="club-row__name">${r.label}</div></div>
        <span style="color:var(--text-3)">›</span>
      </button>`));
  });
  return wrap;
}

function render({ toTop = false } = {}) {
  renderNav();
  const main = $("#main");
  main.innerHTML = "";
  const node = ROUTES[state.view].render(state.params);
  node.classList.add("view");
  main.append(node);
  main.append(footer()); /* every screen, without each one remembering to */
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

  const liveNow = liveBanner();

  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fixtures</h1>
      <p>Kettering Town FC, ${esc(state.league?.season || "2026/27")}. Every game, cup ties included, kept up to date on its own.</p>
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
    <div class="how-to">
      <span class="how-to__row"><span class="pill pill--away">Away</span>
        Tap any fixture for the match, and the away day guide with it: tickets, parking and a pub.</span>
      <span class="how-to__row"><span class="pill pill--home">Home</span>
        Tap for the match, team sheet and everything on the visitors to ${esc(KTFC.ground)}.</span>
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

  if (next) {
    const t = next.team;
    wrap.append(el(`
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
        ${t && next.venue === "Away"
          ? `<div class="hero__row"><button class="btn btn--sm" data-club="${esc(t.id)}">Away day guide</button>
             <a class="btn btn--sm btn--ghost" href="${directionsUrl(t)}" target="_blank" rel="noopener">Directions</a></div>`
          : ""}
      </div>`));

    /* Predictions sit with the game they belong to rather than in a tab of
       their own. Anyone can have a go; the table needs an account. */
    if (predictionsOpen(next)) wrap.append(predictionCard(next, { compact: true }));
  }

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
  if (liveNow) $(".live-slot", wrap).append(liveNow);
  /* Fixtures is where every session starts, so this is where the daily habit
     is worth nudging. The tabs stay as they are - the comment above ROUTES is
     right that four of them is muscle memory. */
  const promo = dailyPromo();
  if (promo) $(".daily-slot", wrap).append(promo);
  $(".otd-slot", wrap).append(onThisDayCard());

  wrap.append(bar);

  if (!shown.length) {
    wrap.append(el(`<div class="empty"><b>Nothing to show</b>No fixtures match that filter yet.</div>`));
    return wrap;
  }

  const ordered = filter === "results" ? [...shown].reverse() : shown;
  let lastMonth = "";
  ordered.forEach((f) => {
    const d = parseDate(f.date);
    const key = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "Date to be confirmed";
    if (key !== lastMonth) {
      lastMonth = key;
      wrap.append(el(`<div class="month">${esc(key)}</div>`));
    }
    wrap.append(fixtureCard(f, { isNext: next && f.id === next.id }));
  });

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
              <td>
                <div class="club-cell">
                  ${r.crest ? `<img src="${esc(r.crest)}" alt="" loading="lazy">` : ""}
                  <span>${esc(clubName(r.name))}</span>
                </div>
              </td>
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
                  <td><div class="club-cell"><span>${esc(r.display_name)}</span></div></td>
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
      <div class="info"><div class="info__label">Miles</div><div class="info__value" style="color:var(--gold-400)">${(s?.miles ?? 0).toLocaleString("en-GB")}</div></div>
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
                  <td><div class="club-cell"><span>${esc(r.display_name)}</span></div></td>
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

function viewClubs() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Away Guide</h1>
      <p>Ground details, ticket prices, parking and a decent pub for all ${TEAMS.length} clubs.</p>
    </div>
    <div class="field"><input type="search" id="club-search" placeholder="Search clubs" aria-label="Search clubs"></div>
    <div id="club-list"></div>
  </div>`);

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

function viewClub({ id, from }) {
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
        </div>
      </div>`));
    const ask = groundPrompt(t, awayTrip);
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
          <div class="info"><div class="info__label">Adult</div><div class="info__value" style="color:var(--gold-400)">${money(t.adultPrice)}</div></div>
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
        ${info?.website
          ? `<div class="btn-row" style="margin-top:10px">
               <a class="btn btn--sm btn--ghost" href="${esc(info.website)}" target="_blank" rel="noopener">${ICON.globe} Check on the ${esc(t.name)} site</a>
             </div>`
          : ""}
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
    box.append(el(`
      <div class="grid grid--2">
        <div class="card">
          <div class="info__label">${ICON.car} Nearest car park</div>
          <div class="info__value" style="margin-bottom:2px">${esc(t.carPark)}</div>
          <div class="hint">${esc(t.parkingHourly)} per hour · ${esc(t.parkingDaily)} on a match day</div>
          <a class="map-link" href="${placeUrl(t.carPark, t.carParkPostcode)}" target="_blank" rel="noopener">${ICON.pin} ${esc(t.carParkPostcode)}</a>
        </div>
        <div class="card">
          <div class="info__label">${ICON.pint} Nearby pub</div>
          <div class="info__value" style="margin-bottom:2px">${esc(t.pub)}</div>
          <div class="hint">Worth a check before you set off. Away support is not always welcome everywhere.</div>
          <a class="map-link" href="${placeUrl(t.pub, t.pubPostcode)}" target="_blank" rel="noopener">${ICON.pin} ${esc(t.pubPostcode)}</a>
        </div>
      </div>`));
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
    db.addPub(team.id, { name, postcode: $("#pb-pc", node).value.trim().toUpperCase(), notes });
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
  const PTABS = [["ground", "Ground"], ["story", "Story"], ["records", "Records"], ["fixtures", "Fixtures"]];
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
        <div class="info"><div class="info__label">League position</div><div class="info__value" style="color:var(--gold-400)">${
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
        <div class="info"><div class="info__label">${esc(KTFC.adultRange)}</div><div class="info__value" style="color:var(--gold-400)">£${KTFC.adultPrice}</div></div>
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

    const people = facts.officials;
    if (people?.board?.length || people?.staff?.length) {
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
      group("Behind the team", people.staff);
      if (people.staffNote) {
        card.append(el(`<p class="note" style="margin:8px 0 14px">${esc(people.staffNote)}</p>`));
      }
      group("The boardroom", people.board);
      if (people.boardNote) {
        card.append(el(`<p class="note" style="margin:8px 0 0">${esc(people.boardNote)}</p>`));
      }
      wrap.append(card);
    }

    wrap.append(el(`<p class="note">Club history from the Kettering Town Wikipedia article and the club's own site.</p>`));
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
        <h2 style="margin:0 0 6px;font-size:19px;font-weight:780">${esc(p.title)}</h2>
        <p style="margin:0;color:var(--text-2);font-size:13px;line-height:1.55">${esc((p.description || "").slice(0, 260))}</p>
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

/** The Kettering names for a fixture: the feed's sheet, or a volunteer's. */
function squadFor(fixture) {
  const fromFeed = fixture.lineup || [];
  if (fromFeed.length) return { players: fromFeed, source: "feed" };
  const typed = db.lineupFor(fixture.id);
  if (typed.length) return { players: typed, source: "volunteer" };
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
    wrap.append(el(`<p class="rating__source">Team sheet added by a volunteer.</p>`));
  }
  if (db.isAdmin()) wrap.append(lineupForm(fixture, players));
  return wrap;
}

/** Volunteers type a team sheet in when the league feed has none. */
function lineupForm(fixture, existing = []) {
  const box = el(`
    <details class="lineup-form">
      <summary>${existing.length ? "Edit the team sheet" : "Add the team sheet"}</summary>
      <p class="note">One player per line, starters first. Put a number in front if you have it, and (c) after the captain. Add "sub" after anyone who came off the bench.</p>
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

    if (stats.gates.length) {
      const avg = Math.round(stats.gates.reduce((n, g) => n + g, 0) / stats.gates.length);
      wrap.append(el(`<h2 class="section-title">At the gate</h2>`));
      wrap.append(el(`
        <div class="card">
          <div class="info-grid info-grid--4">
            <div class="info"><div class="info__label">Home games</div><div class="info__value">${stats.gates.length}</div></div>
            <div class="info"><div class="info__label">Average</div><div class="info__value" style="color:var(--gold-400)">${avg.toLocaleString("en-GB")}</div></div>
            <div class="info"><div class="info__label">Best</div><div class="info__value">${Math.max(...stats.gates).toLocaleString("en-GB")}</div></div>
          </div>
        </div>`));
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
      <div class="info"><div class="info__label">Adult</div><div class="info__value" style="color:var(--gold-400)">${money(t.adultPrice)}</div></div>
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
      <a class="essential__value" href="${placeUrl(t.carPark, t.carParkPostcode)}" target="_blank" rel="noopener">${esc(t.carPark)}${t.parkingDaily ? ` \u00B7 ${esc(t.parkingDaily)} on a match day` : ""}</a></div>`);
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
    `<b>If you have not made an account</b>, nothing about you personally. No tracking, no
     advertising, no analytics following you around. Anything you tick or pick is kept on your own
     phone and never leaves it.`,
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

  wrap.append(el(`<p class="note">Last updated 12 August 2026.</p>`));
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

function viewAdmin() {
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Admin</h1>
      <p>How the site is being used, and the people using it.</p>
    </div>
  </div>`);

  if (!db.isAdmin()) {
    wrap.append(el(`
      <div class="empty">
        <b>Not for you, sorry</b>
        This page is for the volunteers who run the site.
      </div>`));
    return wrap;
  }

  const STATS = [
    ["supporters", "Supporters"], ["supporters_this_week", "Joined this week"],
    ["posts", "Wall posts"], ["replies", "Replies"],
    ["ratings", "Player ratings"], ["predictions", "Predictions"],
    ["attendances", "Games marked"], ["ground_reports", "Ground reports"],
    ["access_reports", "Access reports"], ["price_reports", "Price reports"],
    ["pubs", "Pubs"], ["feedback_waiting", "Feedback waiting"],
  ];

  wrap.append(el(`<h2 class="section-title">Activity</h2>`));
  const statCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
  wrap.append(statCard);

  db.adminOverview().then((o) => {
    statCard.replaceChildren();
    if (!o) {
      statCard.append(el(`<p class="note" style="margin:0">Counts are not available. The newer part of the schema may not have been run yet.</p>`));
      return;
    }
    const grid = el(`<div class="info-grid info-grid--4"></div>`);
    STATS.forEach(([key, label]) => {
      if (o[key] === undefined || o[key] === null) return;
      const urgent = key === "feedback_waiting" && o[key] > 0;
      grid.append(el(`
        <div class="info">
          <div class="info__label">${esc(label)}</div>
          <div class="info__value"${urgent ? ` style="color:var(--gold-400)"` : ""}>${Number(o[key]).toLocaleString("en-GB")}</div>
        </div>`));
    });
    statCard.append(grid);
    statCard.append(el(`<p class="note">These are things people have done on the site, not page views. For visitor numbers, Cloudflare Web Analytics is free and needs no code change.</p>`));
  });

  wrap.append(el(`<h2 class="section-title">People</h2>`));
  const peopleCard = el(`<div class="card"><p class="note" style="margin:0">Loading.</p></div>`);
  wrap.append(peopleCard);

  const paintPeople = () => {
    db.adminPeople().then((rows) => {
      peopleCard.replaceChildren();
      if (!rows.length) {
        peopleCard.append(el(`<p class="note" style="margin:0">Nobody yet.</p>`));
        return;
      }
      const search = el(`<input class="admin-search" type="search" placeholder="Search ${rows.length} supporters" aria-label="Search supporters">`);
      peopleCard.append(search);
      const list = el(`<div></div>`);
      peopleCard.append(list);

      const draw = (filter = "") => {
        const want = filter.trim().toLowerCase();
        const shown = rows.filter((r) => !want || (r.display_name || "").toLowerCase().includes(want));
        list.replaceChildren();
        if (!shown.length) {
          list.append(el(`<p class="note">Nobody by that name.</p>`));
          return;
        }
        shown.slice(0, 60).forEach((r) => {
          const row = el(`
            <div class="person">
              <div class="person__who">
                <span class="person__name">${esc(r.display_name)}</span>
                <span class="person__meta">${r.is_admin ? "Admin \u00B7 " : ""}joined ${esc(fmtDate(String(r.created_at).slice(0, 10), "short"))}</span>
              </div>
            </div>`);
          const picker = el(`<div class="person__tags"></div>`);
          [["", "None"], ...Object.entries(TAG_LABEL)].forEach(([key, label]) => {
            const on = (r.tag || "") === key;
            const b = el(`<button class="tag-btn${on ? " is-on" : ""}" type="button">${esc(label)}</button>`);
            b.addEventListener("click", async () => {
              if (on) return;
              b.disabled = true;
              try {
                await db.setTag(r.id, key || null);
                r.tag = key || null;
                toast(key ? `${r.display_name} is now ${TAG_LABEL[key]}.` : `Tag removed from ${r.display_name}.`, "good");
                draw(search.value);
              } catch (err) {
                toast(err.message || "That did not save.", "bad");
                b.disabled = false;
              }
            });
            picker.append(b);
          });
          row.append(picker);
          list.append(row);
        });
        if (shown.length > 60) {
          list.append(el(`<p class="note">Showing 60 of ${shown.length}. Search to narrow it down.</p>`));
        }
      };

      search.addEventListener("input", () => draw(search.value));
      draw();
    });
  };
  paintPeople();

  return wrap;
}

/* =========================================================== supporter tags */

const TAG_LABEL = {
  contributor: "Contributor",
  "top-contributor": "Top Contributor",
  volunteer: "Volunteer",
  reporter: "Reporter",
  photographer: "Photographer",
  commentator: "Commentator",
  historian: "Historian",
  groundhopper: "Groundhopper",
  legend: "Legend",
};

const TAG_WHY = {
  contributor: "Has added information other supporters rely on",
  "top-contributor": "Has put a great deal into this site",
  volunteer: "Helps run the association",
  reporter: "Writes for the site",
  photographer: "Takes the photographs",
  commentator: "Calls the games",
  historian: "Knows the club's past better than anyone",
  groundhopper: "Does the away days, all of them",
  legend: "One of the good ones",
};

/* A couple of these are meant to stand out from the rest. */
const TAG_SPECIAL = new Set(["top-contributor", "legend"]);

/**
 * The tag next to a name. A volunteer can hand one out, which beats anything
 * worked out from the rows: Darren Young wrote every pen pic on the site and
 * had never filed a ground report, so nothing would have marked him.
 */
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
        <span class="vid__when">${esc(fmtDate(v.published.slice(0, 10), "short"))}</span>
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

  wrap.append(el(`<p class="note">Straight from the club's YouTube channel. Videos are matched to a game by their title, so the odd one may sit under Everything else.</p>`));
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
            <div class="info"><div class="info__label">Appearances</div><div class="info__value" style="color:var(--gold-400)">${past.apps}</div></div>
            <div class="info"><div class="info__label">Seasons</div><div class="info__value">${seasons.length}</div></div>
            <div class="info"><div class="info__label">Shirt</div><div class="info__value">${[...past.shirts].sort((a, b) => a - b).join(", ") || "—"}</div></div>
          </div>
          <div class="hint">${esc(seasons.join(", "))}. First seen ${esc(fmtDate(past.first))}, last ${esc(fmtDate(past.last))}.
          The league's records name no goalscorers before this season, so there are no goals here.</div>
        </div>`));
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
        <div class="info"><div class="info__label">Goals</div><div class="info__value" style="color:var(--gold-400)">${rec.goals}</div></div>
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

/** Goals, cards and gates totted up across every played game so far. */
function seasonStats() {
  const played = fixtures().filter((f) => f.status === "played" && f.events);
  const scorers = new Map();
  const discipline = new Map();
  const gates = [];

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
    if (f.venue === "Home" && f.attendance) gates.push(f.attendance);
  });

  return {
    played: played.length,
    scorers: [...scorers.entries()].map(([name, goals]) => ({ name, goals }))
      .sort((a, b) => b.goals - a.goals),
    discipline: [...discipline.entries()].map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.reds - a.reds || b.yellows - a.yellows),
    gates,
  };
}

/* ================================================================= avatars */

/* Initials plus a colour worked out from the name. Everyone used to get the
   same gold gradient, so a page of posts was a page of identical circles. The
   colour is derived, not stored: the same supporter always gets the same one. */

const AVATAR_TONES = 6;

const initialsFor = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0].charAt(1) || "";
  return (first + last).toUpperCase();
};

const toneFor = (name) => {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % AVATAR_TONES;
};

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

const EMBLEMS = {
  poppy: POPPY_SVG,
  ball: "\u26BD",
  scarf: "\u{1F9E3}",
  shirt: "\u{1F455}",
  boots: "\u{1F45F}",
  trophy: "\u{1F3C6}",
  bus: "\u{1F68C}",
  pint: "\u{1F37A}",
  ticket: "\u{1F39F}\u{FE0F}",
  flag: "\u{1F6A9}",
  drum: "\u{1F941}",
  star: "\u2B50",
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
function avatarHtml(name, profileId, style = "") {
  const emblem = profileId ? db.avatarOf(profileId) : null;
  const badge = emblem && EMBLEMS[emblem];
  return `<span class="avatar avatar--t${toneFor(name)}${badge ? " avatar--emblem" : ""}"
    title="${esc(name || "")}"${style ? ` style="${style}"` : ""}>${badge || esc(initialsFor(name))}</span>`;
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
    }
  }

  wrap.append(composer(t.id));

  const posts = threadPosts(t.id).filter((p) => !p.hidden || db.isAdmin());
  if (!posts.length) {
    wrap.append(el(`<div class="empty"><b>Nothing posted yet</b>Get the conversation going.</div>`));
  } else {
    posts.forEach((p) => wrap.append(wallCard(p, db.isAdmin())));
  }

  return wrap;
}

/** A reply: the same post, drawn quieter and tucked under its parent. */
function replyCard(p, admin, depth = 1) {
  const card = el(`
    <div class="reply" ${p.hidden ? 'style="opacity:.5"' : ""}>
      <div class="post__head">
        ${avatarHtml(p.authorName, p.authorId)}
        <span class="post__who">${esc(p.authorName)}</span>
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
        ${admin ? `<button class="link-btn" data-act="hide">${p.hidden ? "Unhide" : "Hide"}</button>` : ""}
        ${db.canEdit(p) ? `<button class="link-btn" data-act="del">Delete</button>` : ""}
      </div>
      <div class="replies"></div>
    </div>`);

  /* Its own answers, then a box to add one. Stops at MAX_REPLY_DEPTH, which
     the database enforces too, so a stale tab cannot get past it. */
  const holder = card.querySelector(".replies");
  db.list("wall")
    .filter((r) => r.replyTo === p.id && (!r.hidden || admin))
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((r) => holder.append(replyCard(r, admin, depth + 1)));

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

function viewWall() {
  const admin = db.isAdmin();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fan Wall</h1>
      <p>Open to every supporter. Keep it civil and it stays open.</p>
    </div>
  </div>`);

  const onAir = liveBanner();
  if (onAir) wrap.append(onAir);

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

  const posts = db.list("wall").filter((p) => !p.thread && !p.replyTo && (!p.hidden || admin));
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
    posts.forEach((p) => feed.append(wallCard(p, admin)));
    wrap.append(feed);
  }

  return wrap;
}

function wallCard(p, admin) {
  const liked = db.read(`like:${p.id}`, false);
  const card = el(`
    <div class="post" ${p.hidden ? 'style="opacity:.5"' : ""}>
      <div class="post__head">
        ${avatarHtml(p.authorName, p.authorId)}
        <span class="post__who">${esc(p.authorName)}</span>
        ${db.isVolunteer(p.authorId) ? `<span class="pill pill--vol" title="Runs this site">Admin</span>` : ""}
        ${supporterTag(p.authorId)}
        ${p.hidden ? `<span class="pill pill--off">Hidden</span>` : ""}
        <span class="post__when">${esc(relTime(p.createdAt))}</span>
      </div>
      <div class="post__body">${esc(p.text)}</div>
      <div class="post__actions">
        <button class="link-btn" data-act="like">${liked ? "♥" : "♡"} ${p.likes || 0}</button>
        <button class="link-btn" data-act="report">Report</button>
        ${admin ? `<button class="link-btn" data-act="hide">${p.hidden ? "Unhide" : "Hide"}</button>` : ""}
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
      .filter((r) => r.replyTo === p.id && (!r.hidden || admin))
      .sort((a, b) => a.createdAt - b.createdAt);
    kids.forEach((r) => holder.append(replyCard(r, admin, 1)));

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

  card.querySelector('[data-act="like"]').addEventListener("click", () => {
    const now = !liked;
    db.write(`like:${p.id}`, now);
    db.update("wall", p.id, { likes: Math.max(0, (p.likes || 0) + (now ? 1 : -1)) });
    render();
  });
  card.querySelector('[data-act="report"]').addEventListener("click", () => {
    db.update("wall", p.id, { reports: (p.reports || 0) + 1 });
    toast("Reported. Thank you, one of the volunteers will take a look.");
    render();
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

  if (!user) {
    wrap.append(online ? authPanel() : localSignInPanel());
    return wrap;
  }

  const idCard = el(`
    <div class="card">
      <div class="post__head" style="margin-bottom:12px">
        ${avatarHtml(user.name, user.id, "width:44px;height:44px;font-size:15px")}
        <div>
          <div class="post__who" style="font-size:16px">${esc(user.name)}</div>
          <div class="hint" style="margin:0">${user.isAdmin ? "KTFCSA volunteer" : "Supporter"}</div>
        </div>
      </div>
      <div class="emblem-pick">
        <div class="emblem-pick__label">Your badge</div>
        <div class="emblem-pick__row"></div>
      </div>

      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" id="ac-rename">Change name</button>
        <button class="btn btn--ghost btn--sm" id="ac-out">Sign out</button>
        ${!online && user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-lock">Turn off admin tools</button>` : ""}
        ${!online && !user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-admin">Volunteer sign in</button>` : ""}
      </div>
    </div>`);

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
        <div class="info"><div class="info__label">Miles</div><div class="info__value" style="color:var(--gold-400)">${s.miles.toLocaleString("en-GB")}</div></div>
        <div class="info"><div class="info__label">See all</div><div class="info__value"><button class="link-btn" data-nav="season" style="font-size:13px;color:var(--gold-400)">My Season ›</button></div></div>
      </div>`));
  }

  if (user.isAdmin) {
    wrap.append(el(`<h2 class="section-title">Running the site</h2>`));
    const panel = el(`
      <div class="card">
        <p class="note" style="margin:0 0 12px">Activity across the site, and the people using it.</p>
        <button class="btn btn--full" data-nav="admin">Open the admin panel</button>
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
  state.videos = (await readJSON("data/videos.json"))?.videos || [];
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

/** Everyone who has played since 2018, reduced once rather than per render. */
function buildArchiveIndex(a) {
  const out = new Map();
  for (const m of a.matches) {
    for (const [pi, shirt] of m.lineup) {
      const name = a.players[pi];
      if (!out.has(name)) out.set(name, { name, apps: 0, seasons: new Set(), shirts: new Set(), first: m.date, last: m.date });
      const r = out.get(name);
      r.apps += 1;
      r.seasons.add(m.season);
      if (shirt != null) r.shirts.add(shirt);
      if (m.date < r.first) r.first = m.date;
      if (m.date > r.last) r.last = m.date;
    }
  }
  return out;
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
    /* Never claim it copied when it did not - show it so they can take it. */
    modal("Your result", el(`
      <div>
        <p class="hint" style="margin-bottom:10px">Press and hold to copy.</p>
        <textarea readonly rows="5" style="width:100%">${esc(text)}</textarea>
      </div>`));
  });
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
          <div><p>${esc(q.q)}</p><p class="hint">${esc(q.a[q.c])}${q.note ? ` — ${esc(q.note)}` : ""}</p></div>
        </div>`));
    });
    wrap.append(list);
  }

  if (!db.currentUser()) {
    wrap.append(joinPrompt({
      title: "Keep your streak",
      body: "Signing in saves your run across devices and puts you on the leaderboard.",
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
                <td><div class="club-cell"><span>${esc(r.display_name || "A supporter")}</span></div></td>
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
        <p>Everyone who has pulled on a Kettering shirt since 2018, from the league's own team sheets.</p>
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
      list.innerHTML = rows.length ? `
        <div class="table-wrap">
          <table class="league">
            <thead><tr><th>Player</th><th>Apps</th><th>Seasons</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr data-player="${esc(r.name)}" style="cursor:pointer">
                  <td><div class="club-cell"><span>${esc(r.name)}</span></div></td>
                  <td>${r.apps}</td>
                  <td class="hint">${[...r.seasons].sort().join(", ")}</td>
                </tr>`).join("")}
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
      The league's records name no goalscorers before this season, so there are no goal
      counts here. ${all.length} players, ${state.archive.matches.length} matches.</p>`));
  }).catch(() => {
    box.innerHTML = "";
    box.append(el(`<div class="empty"><b>Archive unavailable</b>Please try again shortly.</div>`));
  });
  return wrap;
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
  } catch {
    state.league = null; /* the app falls back to the spreadsheet fixture list */
  }
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
      go(nav.dataset.nav);
      return;
    }
    /* Player names open their profile. Checked before the club handler because
       a player row can sit inside a card that also carries a club id. */
    const player = e.target.closest("[data-player]");
    if (player && player.dataset.player) {
      go("player", { id: encodeURIComponent(player.dataset.player) });
      return;
    }
    const match = e.target.closest("[data-match]");
    if (match && match.dataset.match) {
      go("match", { id: match.dataset.match });
      return;
    }
    const club = e.target.closest("[data-club]");
    if (club && club.dataset.club) {
      go("club", { id: club.dataset.club, from: club.dataset.venue || "" });
    }
  });
}

async function boot() {
  document.documentElement.dataset.theme = db.read("theme", "dark");
  readHash();
  wireGlobalClicks();

  $("#account-btn").addEventListener("click", () => go("account"));
  /* Covers the back and forward buttons as well as the crest link in the
     header. pushState in go() does not fire this, so there is no double paint. */
  window.addEventListener("hashchange", () => {
    readHash();
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

  loadPodcast().then(() => {
    if (state.view === "podcast") render();
  });

  /* keep the countdown honest without hammering the browser */
  setInterval(() => {
    if (state.view === "fixtures") render();
  }, 60000);

  /* Registered from here rather than an inline tag, so the page can run under
     a strict content security policy. */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
