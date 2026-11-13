/**
 * Joining a Glance event from another app's event page ("Join with Glance").
 * Pure helpers shared by the web app and the Convex backend: the link's shape, what
 * it may carry, and the key that ties an outside event to its one Glance event.
 */

/** Apps allowed to open Glance events. A link naming any other source is ignored. */
export const EXTERNAL_SOURCES = ['metaintros'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export interface ExternalJoin {
  source: ExternalSource;
  /** The event's id in the other app. */
  externalId: string;
  title: string;
  location: string;
  /** The person's name in the other app, only to prefill a new Glance profile. */
  name?: string;
}

const tidy = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/** Ids are plain: letters, digits, dash and underscore, at most 64. */
export const validExternalId = (value: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(value);
export const isExternalSource = (value: unknown): value is ExternalSource =>
  typeof value === 'string' && (EXTERNAL_SOURCES as readonly string[]).includes(value);

/** One Glance event per outside event: everyone who joins from the same page lands together. */
export const externalKey = (source: ExternalSource, externalId: string): string => `${source}:${externalId}`;

/**
 * Reads a join link's query (`?source=…&id=…&title=…&place=…&name=…`). Returns null
 * when it does not name an allowed source and a well-formed id with a title, so a
 * mistyped or hostile link does nothing. Text is trimmed and length-limited.
 */
export function parseExternalJoin(params: Record<string, unknown>): ExternalJoin | null {
  const source = first(params.source), externalId = tidy(first(params.id), 80);
  const title = tidy(first(params.title), 100);
  if (!isExternalSource(source) || !validExternalId(externalId) || !title) return null;
  const name = tidy(first(params.name), 80);
  return { source, externalId, title, location: tidy(first(params.place), 160), ...(name ? { name } : {}) };
}

/** The join link's path and query, for navigating back to it (for example after signing up). */
export function externalJoinHref(join: ExternalJoin): string {
  const query = new URLSearchParams({ source: join.source, id: join.externalId, title: join.title });
  if (join.location) query.set('place', join.location);
  if (join.name) query.set('name', join.name);
  return `/join?${query.toString()}`;
}

/** A join waiting for the person to create their profile. Memory only; a reload forgets it. */
let pending: ExternalJoin | null = null;
export const setPendingJoin = (join: ExternalJoin | null): void => { pending = join; };
export const takePendingJoin = (): ExternalJoin | null => { const join = pending; pending = null; return join; };
export const peekPendingJoin = (): ExternalJoin | null => pending;
