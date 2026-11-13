import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'public/tfjs-wasm');
const FILES = ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm'];

describe('face engine WebAssembly binaries', () => {
  it('ships every variant TensorFlow.js may ask for, as real WebAssembly', () => {
    for (const file of FILES) {
      const bytes = readFileSync(path.join(dir, file));
      expect([...bytes.subarray(0, 4)], file).toEqual([0x00, 0x61, 0x73, 0x6d]); // "\0asm"
      expect(bytes.length, file).toBeGreaterThan(200_000);
    }
  });

  it('matches the TensorFlow.js version bundled inside face-api', () => {
    const version = /version (\d+\.\d+\.\d+)/.exec(readFileSync(path.join(dir, 'SOURCE.txt'), 'utf8'))?.[1];
    expect(version).toBeDefined();
    const require = createRequire(path.join(root, 'package.json'));
    const faceApi = require('@vladmandic/face-api/package.json') as { devDependencies?: Record<string, string> };
    const wanted = faceApi.devDependencies?.['@tensorflow/tfjs-backend-wasm'] ?? '';
    // face-api pins its bundled TensorFlow.js with a caret range such as ^4.22.0.
    expect(wanted.replace(/^[\^~]/, '')).toBe(version);
  });

  it('prefers WebAssembly and keeps WebGL only as a fallback', () => {
    const source = readFileSync(path.join(root, 'src/capture/faceEngine.ts'), 'utf8');
    expect(source.indexOf("setBackend('wasm')")).toBeGreaterThan(-1);
    expect(source.indexOf("setBackend('wasm')")).toBeLessThan(source.indexOf("setBackend('webgl')"));
  });
});
