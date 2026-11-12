import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { failureCode, type FacebookActivity } from "./meta";

/**
 * Facebook Login for Glance's Events view. A person signs in, Glance reads the Pages
 * they like and their recent posts once, then removes its own access. Nothing here
 * stores or logs a code, token, secret, URL or response body: failures surface as
 * codes such as FB_LIKES_HTTP_400.
 *
 * Facebook offers apps no way to read Reels, watch history or browsing activity, so
 * those are not requested. See https://developers.facebook.com/docs/permissions
 */
export const FACEBOOK_SCOPES = "user_likes,user_posts";
const MAX_PAGES = 200;
const MAX_POSTS = 25;

export interface FacebookConfig { appId: string; secret: string; dialog: string; graph: string; version: string }

const trimmed = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");
/** Reads the app credentials. The URL overrides exist only to point at a local stand-in. */
export function facebookConfig(env: Record<string, string | undefined>): FacebookConfig {
  const appId = (env.FACEBOOK_APP_ID ?? "").trim(), secret = (env.FACEBOOK_APP_SECRET ?? "").trim();
  const version = (env.FACEBOOK_GRAPH_VERSION ?? "").trim() || "v27.0";
  if (!/^\d{5,24}$/.test(appId) || !secret || !/^v\d{1,3}\.\d{1,2}$/.test(version)) throw new Error("FB_NOT_CONFIGURED");
  return {
    appId, secret, version,
    dialog: trimmed(env.FACEBOOK_DIALOG_BASE_URL) || "https://www.facebook.com",
    graph: trimmed(env.FACEBOOK_GRAPH_BASE_URL) || "https://graph.facebook.com",
  };
}

/**
 * The address Facebook sends the person back to: the root of the web app, over
 * HTTPS (plain HTTP only on this machine, which Facebook allows in development).
 */
export function facebookRedirect(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("FB_BAD_REDIRECT"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (value.length > 300 || !(url.protocol === "https:" || (url.protocol === "http:" && local))
    || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("FB_BAD_REDIRECT");
  return `${url.origin}/`;
}

/** The Login dialog for the manual (redirect) flow. `state` ties the answer to the device that asked. */
export function dialogUrl(config: FacebookConfig, redirectUri: string, state: string): string {
  const query = new URLSearchParams({
    client_id: config.appId, redirect_uri: redirectUri, state, scope: FACEBOOK_SCOPES, response_type: "code",
  });
  return `${config.dialog}/${config.version}/dialog/oauth?${query}`;
}

/** Proves a Graph call comes from the server that holds the app secret. */
export const appSecretProof = (secret: string, accessToken: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(accessToken)));

type Json = Record<string, unknown>;
async function graph(step: string, url: string, method: "GET" | "DELETE" = "GET"): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error(`${step}_NETWORK`);
  }
  if (!response.ok) throw new Error(`${step}_HTTP_${response.status}`);
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") return body as Json;
  } catch { /* fall through */ }
  throw new Error(`${step}_INVALID`);
}
const text = (value: unknown, limit: number) =>
  (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit).trim() : "");
const rows = (body: Json): Json[] =>
  (Array.isArray(body.data) ? body.data.filter((row): row is Json => Boolean(row) && typeof row === "object") : []);
const nextCursor = (body: Json): string => {
  const paging = body.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
  return typeof paging?.next === "string" && typeof paging.cursors?.after === "string" ? paging.cursors.after : "";
};

async function likedPages(root: string, auth: Record<string, string>): Promise<FacebookActivity["pages"]> {
  const pages: FacebookActivity["pages"] = [];
  const seen = new Set<string>();
  let fields = "name,category", after = "";
  for (let page = 0; page < MAX_PAGES / 100; page++) {
    const url = () => `${root}/me/likes?${new URLSearchParams({ fields, limit: "100", ...(after ? { after } : {}), ...auth })}`;
    let body: Json;
    try {
      body = await graph("FB_LIKES", url());
    } catch (error) {
      // A later page failing is no reason to lose the Pages already read.
      if (pages.length) break;
      // The edge's reference does not list `category`; ask for names alone before giving up.
      if (fields === "name" || failureCode(error) !== "FB_LIKES_HTTP_400") throw error;
      fields = "name";
      body = await graph("FB_LIKES", url());
    }
    for (const row of rows(body)) {
      const name = text(row.name, 80);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      pages.push({ name, category: text(row.category, 60) });
    }
    after = nextCursor(body);
    if (!after) break;
  }
  return pages.slice(0, MAX_PAGES);
}

async function recentPosts(root: string, auth: Record<string, string>): Promise<string[]> {
  const body = await graph("FB_POSTS", `${root}/me/posts?${new URLSearchParams({ fields: "message", limit: String(MAX_POSTS), ...auth })}`);
  return rows(body).map((row) => text(row.message, 280)).filter(Boolean).slice(0, MAX_POSTS);
}

/**
 * Exchanges the one-time code, reads liked Pages and recent posts, then removes
 * Glance's access to the account whether or not the read worked. The access token
 * lives only inside this call.
 */
export async function readFacebook(
  config: FacebookConfig, code: string, redirectUri: string,
): Promise<FacebookActivity & { revoked: boolean }> {
  const root = `${config.graph}/${config.version}`;
  const exchange = await graph("FB_TOKEN", `${root}/oauth/access_token?${new URLSearchParams({
    client_id: config.appId, redirect_uri: redirectUri, client_secret: config.secret, code,
  })}`);
  const accessToken = exchange.access_token;
  if (typeof accessToken !== "string" || !accessToken) throw new Error("FB_TOKEN_INVALID");
  const auth = { access_token: accessToken, appsecret_proof: appSecretProof(config.secret, accessToken) };

  let pages: FacebookActivity["pages"] = [], posts: string[] = [];
  let failure: unknown;
  // Someone may grant one permission and decline the other, so each read stands alone.
  try { pages = await likedPages(root, auth); } catch (error) { failure = error; }
  try { posts = await recentPosts(root, auth); } catch (error) { failure ??= error; }
  const revoked = await graph("FB_REVOKE", `${root}/me/permissions?${new URLSearchParams(auth)}`, "DELETE")
    .then((body) => body.success === true, () => false);
  if (!pages.length && !posts.length) throw failure ?? new Error("FB_EMPTY");
  return { pages, posts, revoked };
}

/** A person-readable reason for a failed connect. Never includes provider text. */
export function facebookError(error: unknown): string | undefined {
  const code = failureCode(error);
  if (code === "FB_NOT_CONFIGURED") return "Facebook Login is not set up on this backend. Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET, then try again.";
  if (code === "FB_BAD_REDIRECT") return "Facebook Login needs Glance to be open at its own HTTPS address.";
  if (/^FB_TOKEN_HTTP_/.test(code)) return "Facebook did not accept that sign-in. Check that this address is one of the app’s Valid OAuth Redirect URIs and that the app secret is current, then try again.";
  if (/^FB_(LIKES|POSTS)_HTTP_/.test(code)) return "Facebook would not share your liked Pages or posts. You may have declined those permissions. You can type your interests instead.";
  if (code === "FB_EMPTY") return "Facebook returned no liked Pages or posts. You may have declined those permissions, or there is nothing there yet. You can type your interests instead.";
  if (code === "FB_NO_INTERESTS") return "Muse did not find interests in your liked Pages or posts. You can type a few instead.";
  if (/^FB_[A-Z]+_NETWORK$/.test(code)) return "The backend could not reach Facebook.";
  if (/^FB_[A-Z]+_INVALID$/.test(code)) return "Facebook returned a response Glance could not read.";
  return undefined;
}
