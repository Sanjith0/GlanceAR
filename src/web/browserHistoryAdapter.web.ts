import { createBrowserHistoryAdapter as createExpoBrowserHistoryAdapter } from 'expo-router/build/global-state/browserHistoryAdapter';
import type { BrowserHistoryAdapter } from 'expo-router/build/global-state/browserHistory.types';
import { currentDocumentPath, documentRouteHref, routeFromDocumentPath } from './location';

/**
 * Retain Expo 58's ordered history operations, entry IDs and back/forward
 * suppression. Translate only the boundary between route paths and browser URLs.
 */
export function createBrowserHistoryAdapter(): BrowserHistoryAdapter {
  const adapter = createExpoBrowserHistoryAdapter();
  const documentPath = currentDocumentPath();
  return {
    apply: (event) => adapter.apply(event.op === 'go'
      ? event
      : { ...event, path: documentRouteHref(event.path, documentPath) }),
    listen: (listener) => adapter.listen((change) => listener({
      ...change,
      path: routeFromDocumentPath(change.path),
    })),
  };
}
