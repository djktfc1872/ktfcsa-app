/* Settings an administrator may want to change. Everything here is public,
   so never put a real secret in this file. */

export const CONFIG = {
  /* Fill these in from your Supabase project: Settings -> API.
     The anon key is designed to be public. Row level security is what protects
     the data, not this key. Leave the url blank and the app runs on this
     device only, with no accounts. */
  supabase: {
    url: "https://fgbvbenxiyclkujuabgx.supabase.co",
    anonKey: "sb_publishable_hGdWCAq4JkzLn---P185Iw_TDSjtzTg",
  },

  /* Shown in the footer. */
  credit: {
    name: "Danny Jordan",
    email: "danny@ktfcsa.com",
  },

  /* How predictions are scored. */
  scoring: {
    exact: 3,
    outcome: 1,
  },

  /* Car share posts disappear this many days after the fixture they relate to. */
  liftExpiryDays: 2,

  /* Only used when the app is running without Supabase, so a supporter can
     still try the admin tools locally. */
  localAdminPasscode: "poppies-volunteers",

  /* How long a local-only sign-in lasts, in days. */
  sessionDays: 180,
};

/* Words that get a post held back. Kept deliberately short and blunt: the aim
   is to stop the obvious stuff, not to police banter. */
export const BLOCKED_WORDS = [
  "cunt", "fuck", "fucking", "fucker", "shit", "bastard", "wanker", "twat",
  "prick", "bollocks", "slag", "whore", "nonce", "paki", "nigger", "nigga",
  "faggot", "fag", "tranny", "retard", "spastic", "yid", "pikey",
];

/* Phrases that suggest someone is trying to sell something or phish. */
export const SPAM_PATTERNS = [
  /\b(?:buy|cheap|discount|free)\s+(?:viagra|cialis|followers|crypto|bitcoin)\b/i,
  /\b(?:click|visit)\s+here\s+(?:now|to\s+win)\b/i,
  /\bwhatsapp\s*\+?\d{7,}/i,
  /\b(?:t\.me|bit\.ly|tinyurl\.com)\/\S+/i,
];
