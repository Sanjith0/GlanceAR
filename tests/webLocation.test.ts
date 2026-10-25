import { describe, expect, it } from 'vitest';
import { documentRouteHref, routeFromDocumentPath } from '../src/web/location';

describe('portable web route URLs', () => {
  const documentPath = '/sites/proxy/signed-token/web/direct-files/glancear/dist/index.html?preview=1';
  it('starts at home without treating the hosting path as an app route', () => {
    expect(routeFromDocumentPath(documentPath)).toBe('/');
    expect(routeFromDocumentPath(documentPath + '#section')).toBe('/');
    expect(routeFromDocumentPath(documentPath + '#//outside.example')).toBe('/');
  });
  it.each(['/', '/events', '/connections', '/profile', '/enroll', '/event/demo', '/conversation/demo', '/recap/demo?view=shared'])(
    'round trips %s while preserving the arbitrary hosting path and query',
    (route) => {
      const href = documentRouteHref(route, documentPath);
      expect(href).toBe(documentPath + '#' + route);
      expect(routeFromDocumentPath(href)).toBe(route);
    },
  );
  it('replaces a previous route without accumulating fragments', () => {
    expect(documentRouteHref('/profile', documentPath + '#/events')).toBe(documentPath + '#/profile');
  });
  it.each(['https://example.com/', 'mailto:hello@example.com', '//example.com/'])(
    'preserves the external href %s',
    (href) => expect(documentRouteHref(href, documentPath)).toBe(href),
  );
});
