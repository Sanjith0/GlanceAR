/**
 * Static web previews can live under an arbitrary, signed document URL.
 * Keep that document (and its query) intact; only the hash belongs to Router.
 * No browser APIs are replaced, and no browser storage is used.
 */
export function routeFromDocumentPath(path: string): string {
  const hashIndex = path.indexOf('#');
  const route = hashIndex < 0 ? '' : path.slice(hashIndex + 1);
  return route.startsWith('/') && !route.startsWith('//') ? route : '/';
}

export function documentRouteHref(route: string, documentPath: string): string {
  // Preserve external links, including protocol-relative URLs.
  if (!route.startsWith('/') || route.startsWith('//')) return route;
  return `${documentPath.split('#', 1)[0]}#${route}`;
}

export function currentDocumentPath(): string {
  return typeof window === 'undefined'
    ? '/'
    : window.location.pathname + window.location.search;
}
