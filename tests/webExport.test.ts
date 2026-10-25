import { describe, expect, it } from 'vitest';
import { portableReferences } from '../scripts/portable-web-export.mjs';

describe('portable Expo export references', () => {
  it('rewrites entry scripts, lazy chunks, fonts and images without embedding a host', () => {
    const original = '<script src="/_expo/static/js/web/entry.js"></script>' +
      '{"paths":{"1":"/_expo/static/js/web/event.js"}};' +
      'module.exports="/assets/node_modules/@expo/font.ttf";' +
      'const feather="/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf";' +
      'const image={uri:"/assets/portrait.jpg"};' +
      '<link href="/favicon.ico">';
    const result = portableReferences(original);
    expect(result).toContain('src="./_expo/static/js/web/entry.js"');
    expect(result).toContain('"1":"./_expo/static/js/web/event.js"');
    expect(result).toContain('"./assets/vendor/@expo/font.ttf"');
    expect(result).toContain('"./assets/vendor/@expo/vector-icons/package-assets/vendor/react-native-vector-icons/Fonts/Feather.ttf"');
    expect(result).not.toContain('/build/');
    expect(result).toContain('uri:"./assets/portrait.jpg"');
    expect(result).toContain('href="./favicon.ico"');
    expect(portableReferences(result)).toBe(result);
  });
  it('does not rewrite remote URLs, route paths, or source app asset paths', () => {
    const text = '"https://example.com/assets/image.png";"/events";"./assets/icon.png"';
    expect(portableReferences(text)).toBe(text);
  });
});
