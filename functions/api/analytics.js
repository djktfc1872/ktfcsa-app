/**
 * Cloudflare Web Analytics, read server side and handed to the admin panel.
 *
 * This exists because the alternative does not work. Cloudflare's analytics
 * need an API token, and anything the browser holds is public: the repo is
 * public, and a key shipped to a page is a key given to everyone who opens it.
 * So the token stays here, in the Pages environment, and never leaves.
 *
 * Required environment variables, set in the Cloudflare Pages dashboard under
 * Settings > Environment variables. None of them belong in the repo:
 *
 *   CF_API_TOKEN   an API token with Account Analytics: Read, and nothing else
 *   CF_ACCOUNT_ID  the account the site sits in
 *   CF_SITE_TAG    the Web Analytics site tag for fans.ktfcsa.com
 *   SUPABASE_URL   the project URL, used only to check who is asking
 *
 * Only volunteers get an answer. The caller sends their own Supabase access
 * token, this asks Supabase who that is, and then asks -- as that person, so
 * row level security still applies -- whether they are an admin. No service
 * role key is involved, so a mistake here cannot become a way around RLS.
 */

const DAYS = 30;

async function callerIsAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !env.SUPABASE_URL) return false;

  const anon = env.SUPABASE_ANON_KEY || "";
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anon },
  });
  if (!who.ok) return false;
  const user = await who.json();
  if (!user?.id) return false;

  /* Asked as the caller, not as the owner: if they are not an admin, RLS
     returns nothing and so does this. */
  const prof = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
    { headers: { Authorization: `Bearer ${token}`, apikey: anon } },
  );
  if (!prof.ok) return false;
  const rows = await prof.json();
  return Boolean(rows?.[0]?.is_admin);
}

async function graphql(env, query, variables) {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message || "Cloudflare refused that.");
  return body.data;
}

const BY_DAY = `
  query ($account: String!, $site: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        rumPageloadEventsAdaptiveGroups(
          filter: { siteTag: $site, datetime_geq: $start, datetime_leq: $end }
          limit: 1000
          orderBy: [date_ASC]
        ) {
          count
          sum { visits }
          dimensions { date }
        }
      }
    }
  }`;

const BY_PATH = `
  query ($account: String!, $site: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        rumPageloadEventsAdaptiveGroups(
          filter: { siteTag: $site, datetime_geq: $start, datetime_leq: $end }
          limit: 25
          orderBy: [count_DESC]
        ) {
          count
          sum { visits }
          dimensions { requestPath }
        }
      }
    }
  }`;

export async function onRequestGet({ request, env }) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_SITE_TAG) {
    return json({ error: "not-configured" }, 501);
  }
  if (!(await callerIsAdmin(request, env))) return json({ error: "not-allowed" }, 403);

  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86400000);
  const vars = {
    account: env.CF_ACCOUNT_ID,
    site: env.CF_SITE_TAG,
    start: start.toISOString(),
    end: end.toISOString(),
  };

  try {
    const [days, paths] = await Promise.all([
      graphql(env, BY_DAY, vars),
      graphql(env, BY_PATH, vars),
    ]);
    const pick = (d) => d?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups || [];
    return json({
      days: pick(days).map((r) => ({
        day: r.dimensions.date, views: r.count, visits: r.sum?.visits ?? 0,
      })),
      paths: pick(paths).map((r) => ({
        path: r.dimensions.requestPath, views: r.count, visits: r.sum?.visits ?? 0,
      })),
    });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}
