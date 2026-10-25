import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const HAND_MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
export const HAND_RUNTIME_VERSION = '0.10.32';
const runtimeFiles = [
  'vision_wasm_internal.js', 'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm',
];
const hash = value => createHash('sha256').update(value).digest('hex');

/** No runtime CDN requests. A clean install pins and checks the model before use. */
export async function copyHandModels(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const source = path.dirname(require.resolve('@mediapipe/tasks-vision'));
  const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (metadata.version !== HAND_RUNTIME_VERSION) throw new Error('Unexpected hand runtime version; review the pin before upgrading.');
  const target = path.join(root, 'public/models/hand-landmarker');
  await mkdir(path.join(target, 'wasm'), { recursive: true });
  const filename = path.join(target, 'hand_landmarker.task');
  let current;
  try { current = await readFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!current || hash(current) !== HAND_MODEL_SHA256) {
    const response = await fetch(HAND_MODEL_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Hand model download failed (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 20_000_000 || hash(bytes) !== HAND_MODEL_SHA256) throw new Error('Hand model integrity check failed.');
    await writeFile(`${filename}.tmp`, bytes);
    await rename(`${filename}.tmp`, filename);
  }
  for (const file of runtimeFiles) await copyFile(path.join(source, 'wasm', file), path.join(target, 'wasm', file));
  await copyFile(path.join(root, 'docs/licenses/mediapipe-Apache-2.0.txt'), path.join(target, 'LICENSE.txt'));
  await writeFile(path.join(target, 'NOTICE.txt'), [
    'MediaPipe Tasks Vision, Google LLC, Apache-2.0.',
    `Runtime: @mediapipe/tasks-vision ${HAND_RUNTIME_VERSION}`,
    `Hand Landmarker float16 model version 1: ${HAND_MODEL_URL}`,
    `SHA-256: ${HAND_MODEL_SHA256}`,
    'Runtime license: https://www.apache.org/licenses/LICENSE-2.0',
    'Only hand landmarks are processed by this module; frames are not uploaded.',
    '',
  ].join('\n'));
  console.log(`Hand models: SHA-256 verified; runtime ${HAND_RUNTIME_VERSION} copied to public/models/hand-landmarker.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyHandModels(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
