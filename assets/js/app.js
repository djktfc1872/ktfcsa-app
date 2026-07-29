/* Poppies Fan Companion - views and routing.
   Plain ES modules, no build step and no third party libraries. */

import { TEAMS, KTFC } from "./data.js";
import { CONFIG } from "./config.js";
import * as db from "./store.js";

/* ================================================================= helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
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

const mapUrl = (t) =>
  t.lat && t.lng
    ? `https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.postcode || t.name)}`;

const placeUrl = (label, postcode) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([label, postcode].filter(Boolean).join(", "))}`;

const directionsUrl = (t) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(KTFC.postcode)}&destination=${
    t.lat && t.lng ? `${t.lat},${t.lng}` : encodeURIComponent(t.postcode)
  }`;

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
  route: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M18 15.5a2.5 2.5 0 0 0-2.45 2H11a2.5 2.5 0 0 1 0-5h2a4.5 4.5 0 0 0 0-9 4.5 4.5 0 0 0-4.45 4h-2A2.5 2.5 0 1 0 6 10.5h2.05a4.5 4.5 0 0 0 .95 2H11a4.5 4.5 0 0 0 0 9h4.55A2.5 2.5 0 1 0 18 15.5Z"/></svg>`,
  pint: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M6 3h12l-1.2 17.1A2 2 0 0 1 14.8 22H9.2a2 2 0 0 1-2-1.9L6 3Zm2.2 2 .2 3h7.2l.2-3H8.2Z"/></svg>`,
  car: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5A1.5 1.5 0 0 1 4.5 11H5Zm2.1 0h9.8l-1-3H8.1l-1 3ZM6.5 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm11 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>`,
};

/** The credit line, shown at the foot of the longer screens. */
function footer() {
  const { name, email } = CONFIG.credit;
  return el(`
    <footer class="app-footer">
      <div>Website by ${esc(name)}. All rights reserved.</div>
      <div class="app-footer__contact">
        <a href="mailto:${esc(email)}">${esc(email)}</a>
      </div>
    </footer>`);
}

function toast(message) {
  $(".toast")?.remove();
  const node = el(`<div class="toast" role="status">${esc(message)}</div>`);
  document.body.append(node);
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
  predictTab: "open",
};

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
const ROUTES = {
  fixtures: { label: "Fixtures", icon: "⚽", nav: "tab", render: viewFixtures },
  table: { label: "Table", icon: "🏆", nav: "tab", render: viewTable },
  travel: { label: "Travel", icon: "🚌", nav: "tab", render: viewTravel },
  wall: { label: "Fan Wall", icon: "💬", nav: "tab", render: viewWall },
  predict: { label: "Prediction League", icon: "🎯", nav: "more", render: viewPredict },
  season: { label: "My Season", icon: "📈", nav: "more", render: viewSeason },
  clubs: { label: "Away Guide", icon: "📖", nav: "more", render: viewClubs },
  podcast: { label: "Poppycast", icon: "🎙️", nav: "more", render: viewPodcast },
  feedback: { label: "Send Feedback", icon: "✉️", nav: "more", render: viewFeedback },
  account: { label: "Account", icon: "👤", nav: "more", render: viewAccount },
  more: { label: "More", icon: "⋯", nav: "hidden", render: viewMore },
  club: { label: "Club", icon: "📍", nav: "hidden", render: viewClub },
};

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  const hash = params.id ? `#/${view}/${params.id}` : `#/${view}`;
  if (location.hash !== hash) history.pushState(null, "", hash);
  render({ toTop: true });
}

function readHash() {
  const [, view, id] = (location.hash || "#/fixtures").split("/");
  state.view = ROUTES[view] ? view : "fixtures";
  state.params = id ? { id: decodeURIComponent(id) } : {};
}

/* =================================================================== chrome */

const routesWhere = (...kinds) => Object.entries(ROUTES).filter(([, r]) => kinds.includes(r.nav));

function renderNav() {
  $("#sidebar").innerHTML = routesWhere("tab", "more")
    .map(([key, r]) => `
      <button class="sidebar__link ${state.view === key ? "is-active" : ""}" data-nav="${key}">
        <span class="ic" aria-hidden="true">${r.icon}</span>${r.label}
      </button>`)
    .join("");

  /* The More screen stands in for everything that will not fit on a phone. */
  const onMore = routesWhere("more").some(([key]) => key === state.view) || state.view === "more";
  $("#tabbar").innerHTML =
    routesWhere("tab")
      .map(([key, r]) => `
        <button class="${state.view === key ? "is-active" : ""}" data-nav="${key}"
                aria-current="${state.view === key ? "page" : "false"}">
          <span class="ic" aria-hidden="true">${r.icon}</span>${r.label}
        </button>`)
      .join("") +
    `<button class="${onMore ? "is-active" : ""}" data-nav="more"
             aria-current="${onMore ? "page" : "false"}">
       <span class="ic" aria-hidden="true">⋯</span>More
     </button>`;

  const user = db.currentUser();
  $("#account-btn").innerHTML = user
    ? `<span class="avatar" title="${esc(user.name)}">${esc(user.initials)}</span>`
    : `<span class="btn btn--sm">Sign in</span>`;
}

function viewMore() {
  const wrap = el(`<div>
    <div class="page-head"><h1>More</h1><p>Everything else in the app.</p></div>
  </div>`);
  routesWhere("more").forEach(([key, r]) => {
    wrap.append(el(`
      <button class="club-row" data-nav="${key}">
        <span style="font-size:19px;width:26px;text-align:center" aria-hidden="true">${r.icon}</span>
        <div style="flex:1;min-width:0"><div class="club-row__name">${r.label}</div></div>
        <span style="color:var(--text-3)">›</span>
      </button>`));
  });
  wrap.append(footer());
  return wrap;
}

function render({ toTop = false } = {}) {
  renderNav();
  const main = $("#main");
  main.innerHTML = "";
  const node = ROUTES[state.view].render(state.params);
  node.classList.add("view");
  main.append(node);
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
            data-club="${esc(f.team?.id || "")}">
      <div class="fixture__date">
        <div class="fixture__day">${d ? d.getDate() : "?"}</div>
        <div class="fixture__mon">${d ? MONTHS[d.getMonth()].slice(0, 3) : "TBC"}</div>
      </div>
      ${f.opponentCrest ? `<img class="fixture__crest" src="${esc(f.opponentCrest)}" alt="" loading="lazy">` : ""}
      <div class="fixture__body">
        <div class="fixture__opp">${esc(clubName(f.opponent))}</div>
        <div class="fixture__sub">${d ? DAYS[d.getDay()].slice(0, 3) : ""}${
          f.competition ? ` · ${esc(f.competition)}` : ""
        }${f.team && !isHome ? ` · ${f.team.distanceMiles} mi` : ""}</div>
      </div>
      <div class="fixture__right">
        ${statusPill}
        ${scoreHtml || `<div class="fixture__ko">${esc(f.kickoff || "TBC")}</div>`}
      </div>
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

  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fixtures</h1>
      <p>Kettering Town, ${esc(state.league?.season || "2026/27")}. Everything else in the app works around this list.</p>
    </div>
  </div>`);

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
      <div style="flex:1"></div>
      <button class="btn btn--sm btn--ghost" data-nav="clubs">Away guide</button>
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

  wrap.append(el(`
    <div class="table-wrap">
      <table class="league">
        <thead>
          <tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>GD</th><th>Pts</th></tr>
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
              <td class="pts">${r.points}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`));

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
    wrap.append(footer());
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

  wrap.append(footer());
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
    const h = Number(homeIn.value);
    const a = Number(awayIn.value);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 20 || a > 20) {
      return toast("Enter a score between 0 and 20 for both sides.");
    }
    if (!predictionsOpen(f)) return toast("That match has kicked off, so predictions are closed.");
    db.savePrediction(f.id, h, a);
    toast(signedIn ? "Prediction saved." : "Saved on this device.");
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
    wrap.append(el(`<div class="empty"><b>Sign in to track your season</b>Your record follows your account between devices.</div>`));
    wrap.append(el(`<div class="btn-row" style="justify-content:center"><button class="btn" data-nav="account">Sign in or join</button></div>`));
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
  wrap.append(footer());
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

function viewClub({ id }) {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) {
    const miss = el(`<div><div class="empty"><b>Club not found</b>Head back to the away guide.</div></div>`);
    return miss;
  }

  const ours = fixtures().filter((f) => f.team?.id === t.id);
  const crest = ours.find((f) => f.opponentCrest)?.opponentCrest;

  const wrap = el(`<div>
    <button class="back-link" data-nav="clubs">← Away guide</button>
    <div class="hub-hero">
      ${crest ? `<img class="hub-hero__crest" src="${esc(crest)}" alt="">` : ""}
      <div class="hub-hero__text">
        <h1>${esc(t.name)}</h1>
        <p>${esc(t.nickname)} · ${esc(t.stadium)} · ${t.distanceMiles} miles from ${esc(KTFC.ground)}</p>
      </div>
    </div>
  </div>`);

  /* fixtures against this club */
  if (ours.length) {
    wrap.append(el(`<h2 class="section-title">This season</h2>`));
    ours.forEach((f) => wrap.append(fixtureCard(f)));
  }

  /* ground */
  wrap.append(el(`<h2 class="section-title">The ground</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Ground</div><div class="info__value">${esc(t.stadium)}</div></div>
        <div class="info"><div class="info__label">Capacity</div><div class="info__value">${
          typeof t.capacity === "number" ? t.capacity.toLocaleString("en-GB") : esc(t.capacity)
        }</div></div>
        <div class="info"><div class="info__label">Distance</div><div class="info__value">${t.distanceMiles} miles</div></div>
        <div class="info"><div class="info__label">Postcode</div><div class="info__value">${esc(t.postcode)}</div></div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <a class="btn btn--sm" href="${directionsUrl(t)}" target="_blank" rel="noopener">${ICON.route} Directions from ${esc(KTFC.ground)}</a>
        <a class="btn btn--sm btn--ghost" href="${mapUrl(t)}" target="_blank" rel="noopener">${ICON.pin} Open ground in Maps</a>
      </div>
    </div>`));

  /* tickets */
  wrap.append(el(`<h2 class="section-title">On the gate</h2>`));
  wrap.append(el(`
    <div class="card">
      <div class="info-grid info-grid--4">
        <div class="info"><div class="info__label">Adult</div><div class="info__value" style="color:var(--gold-400)">${money(t.adultPrice)}</div></div>
        <div class="info"><div class="info__label">Concession</div><div class="info__value">${money(t.concessionPrice)}</div></div>
        <div class="info"><div class="info__label">Youth · ${esc(t.youthRange)}</div><div class="info__value">${money(t.youthPrice)}</div></div>
        <div class="info"><div class="info__label">Child · ${esc(t.childRange)}</div><div class="info__value">${money(t.childPrice)}</div></div>
      </div>
      ${t.ticketNotes ? `<div class="hint" style="margin-top:10px">${esc(t.ticketNotes)}</div>` : ""}
      <div class="hint">Prices are a guide taken from the club's published rates. Always check with the club before you travel.</div>
    </div>`));

  /* parking and pub */
  wrap.append(el(`<h2 class="section-title">Parking and the pub</h2>`));
  wrap.append(el(`
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

  /* supporter pub suggestions */
  wrap.append(el(`<h2 class="section-title">Supporter recommendations</h2>`));
  wrap.append(pubBoard(t));

  /* fact */
  if (t.fact) {
    wrap.append(el(`<h2 class="section-title">Worth knowing</h2>`));
    wrap.append(el(`<div class="card"><div class="info__value info__value--body">${esc(t.fact)}</div></div>`));
  }

  return wrap;
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
    if (!check.ok) return toast(check.reason);
    const limit = db.rateLimit("pub", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason);
    db.addPub(team.id, { name, postcode: $("#pb-pc", node).value.trim().toUpperCase(), notes });
    close();
    toast("Thanks, that is on the board.");
  });
}

/* ================================================================== travel */

function viewTravel() {
  const admin = db.isAdmin();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Travel</h1>
      <p>Official coach details from the committee, plus a car share board run by supporters.</p>
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
      admin ? "Use the button above to post this week's details." : "The committee will post details here each week."
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
        <span class="avatar">${esc((l.authorName || "?").slice(0, 2).toUpperCase())}</span>
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
      if (!check.ok) return toast(check.reason);
    }
    const limit = db.rateLimit("lift", { max: 4, windowMs: 300000 });
    if (!limit.ok) return toast(limit.reason);

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
    toast("Posted to the car share board.");
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

/* ================================================================ fan wall */

function viewWall() {
  const user = db.currentUser();
  const admin = db.isAdmin();
  const wrap = el(`<div>
    <div class="page-head">
      <h1>Fan Wall</h1>
      <p>Open to every supporter. Keep it civil and it stays open.</p>
    </div>
  </div>`);

  /* ---- polls ---- */
  const polls = db.list("poll");
  if (polls.length || admin) {
    wrap.append(el(`<h2 class="section-title">Polls</h2>`));
    if (admin) {
      const b = el(`<button class="btn btn--sm" style="margin-bottom:10px">Create a poll</button>`);
      b.addEventListener("click", pollForm);
      wrap.append(b);
    }
    if (!polls.length) {
      wrap.append(el(`<div class="empty"><b>No polls running</b>Create one to get supporters talking.</div>`));
    }
    polls.forEach((p) => wrap.append(pollCard(p)));
  }

  /* ---- composer ---- */
  wrap.append(el(`<h2 class="section-title">The wall</h2>`));

  if (!user) {
    wrap.append(el(`<div class="notice notice--info">Sign in to post. All it needs is a name, and it stays on this device.</div>`));
  } else {
    const box = el(`
      <div class="card" style="margin-bottom:16px">
        <label for="wall-text" class="sr-only">Your message</label>
        <textarea id="wall-text" maxlength="600" placeholder="What did you make of that, then?"></textarea>
        <div class="char-count" id="wall-count">0 / 600</div>
        <div class="btn-row"><button class="btn btn--sm" id="wall-post">Post</button></div>
      </div>`);
    const ta = $("#wall-text", box);
    const count = $("#wall-count", box);
    ta.addEventListener("input", () => {
      count.textContent = `${ta.value.length} / 600`;
      count.classList.toggle("is-over", ta.value.length > 600);
    });
    $("#wall-post", box).addEventListener("click", () => {
      const check = db.checkPost(ta.value);
      if (!check.ok) return toast(check.reason);
      const limit = db.rateLimit("wall", { max: 5, windowMs: 120000 });
      if (!limit.ok) return toast(limit.reason);
      db.add("wall", { text: ta.value.trim() });
      ta.value = "";
      toast("Posted.");
      render();
    });
    wrap.append(box);
  }

  const posts = db.list("wall").filter((p) => !p.hidden || admin);
  if (!posts.length) {
    wrap.append(el(`<div class="empty"><b>Nothing posted yet</b>Get the conversation going.</div>`));
    return wrap;
  }

  posts.forEach((p) => wrap.append(wallCard(p, admin)));
  return wrap;
}

function wallCard(p, admin) {
  const liked = db.read(`like:${p.id}`, false);
  const card = el(`
    <div class="post" ${p.hidden ? 'style="opacity:.5"' : ""}>
      <div class="post__head">
        <span class="avatar">${esc((p.authorName || "?").slice(0, 2).toUpperCase())}</span>
        <span class="post__who">${esc(p.authorName)}</span>
        ${p.hidden ? `<span class="pill pill--off">Hidden</span>` : ""}
        <span class="post__when">${esc(relTime(p.createdAt))}</span>
      </div>
      <div class="post__body">${esc(p.text)}</div>
      <div class="post__actions">
        <button class="link-btn" data-act="like">${liked ? "♥" : "♡"} ${p.likes || 0}</button>
        <button class="link-btn" data-act="report">Report</button>
        ${admin ? `<button class="link-btn" data-act="hide">${p.hidden ? "Unhide" : "Hide"}</button>` : ""}
        ${db.canEdit(p) ? `<button class="link-btn" data-act="del">Delete</button>` : ""}
      </div>
    </div>`);

  card.querySelector('[data-act="like"]').addEventListener("click", () => {
    const now = !liked;
    db.write(`like:${p.id}`, now);
    db.update("wall", p.id, { likes: Math.max(0, (p.likes || 0) + (now ? 1 : -1)) });
    render();
  });
  card.querySelector('[data-act="report"]').addEventListener("click", () => {
    db.update("wall", p.id, { reports: (p.reports || 0) + 1 });
    toast("Reported. Thank you, the committee will take a look.");
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
  const { node, close } = modal(`
    <h2>Create a poll</h2>
    <p class="sub">Two to four options works best.</p>
    <div class="field"><label for="pf-q">Question</label>
      <input id="pf-q" maxlength="120" placeholder="Who was your man of the match?"></div>
    ${[1, 2, 3, 4].map((n) => `
      <div class="field"><label for="pf-o${n}">Option ${n}${n > 2 ? " (optional)" : ""}</label>
        <input id="pf-o${n}" maxlength="60"></div>`).join("")}
    <div class="btn-row">
      <button class="btn btn--full" id="pf-save">Publish poll</button>
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
    db.add("poll", { question, options });
    close();
    toast("Poll published.");
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
      <p>Tell the committee what the app does well and what it does not. It goes
         straight to them, and nobody else sees it.</p>
    </div>
  </div>`);

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
      <button class="btn btn--full" id="fb-send">Send to the committee</button>
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
    if (!check.ok) return toast(check.reason);

    const limit = db.rateLimit("feedback", { max: 3, windowMs: 600000 });
    if (!limit.ok) return toast(limit.reason);

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
      toast(queued ? "Saved. It will send once the app is online." : "Thanks, that is with the committee.");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });

  wrap.append(form);

  /* The committee reads what has come in without leaving the app. */
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

  wrap.append(footer());
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
    wrap.append(footer());
    return wrap;
  }

  wrap.append(el(`
    <div class="card">
      <div class="post__head" style="margin-bottom:12px">
        <span class="avatar" style="width:44px;height:44px;font-size:15px">${esc(user.initials)}</span>
        <div>
          <div class="post__who" style="font-size:16px">${esc(user.name)}</div>
          <div class="hint" style="margin:0">${user.isAdmin ? "Committee admin" : "Supporter"}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" id="ac-rename">Change name</button>
        <button class="btn btn--ghost btn--sm" id="ac-out">Sign out</button>
        ${!online && user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-lock">Turn off admin tools</button>` : ""}
        ${!online && !user.isAdmin ? `<button class="btn btn--ghost btn--sm" id="ac-admin">Committee sign in</button>` : ""}
      </div>
    </div>`));

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
        toast("Name updated.");
        render();
      } catch (err) {
        toast(err.message);
      }
    });
  });

  $("#ac-out", wrap).addEventListener("click", async () => {
    await db.signOut();
    toast("Signed out.");
    render();
  });

  $("#ac-lock", wrap)?.addEventListener("click", () => {
    db.lockLocalAdmin();
    toast("Admin tools turned off.");
    render();
  });

  $("#ac-admin", wrap)?.addEventListener("click", () => {
    const { node, close } = modal(`
      <h2>Committee sign in</h2>
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

  wrap.append(footer());
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
          <input id="au-pass" type="password" autocomplete="new-password" placeholder="At least six characters"></div>`));
      const go = el(`<button class="btn btn--full">Create account</button>`);
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          await db.signUp($("#au-email", box).value, $("#au-pass", box).value, $("#au-name", box).value);
          toast("Welcome along.");
          render();
        } catch (err) {
          toast(err.message);
          go.disabled = false;
        }
      });
      body.append(go);
      return;
    }

    body.append(el(`
      <div class="field"><label for="ai-email">Email address</label>
        <input id="ai-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="ai-pass">Password</label>
        <input id="ai-pass" type="password" autocomplete="current-password"></div>`));
    const go = el(`<button class="btn btn--full">Sign in</button>`);
    const attempt = async () => {
      go.disabled = true;
      try {
        await db.signIn($("#ai-email", box).value, $("#ai-pass", box).value);
        toast("Signed in.");
        render();
      } catch (err) {
        toast(err.message);
        go.disabled = false;
      }
    };
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
    const club = e.target.closest("[data-club]");
    if (club && club.dataset.club) {
      go("club", { id: club.dataset.club });
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

  render({ toTop: true }); /* paint immediately with the bundled data */

  /* Fixtures and accounts are independent, so fetch them at the same time.
     Whichever lands first redraws. In the online setup the store also streams
     live updates, so a new car share or wall post appears without a refresh. */
  await Promise.all([
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
