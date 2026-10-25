import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the three networks LIVE Camera loads (~7 MB). Copied from the installed
// package so the weights always match its code; public/ is exported beside index.html.
const MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];

export async function copyFaceModels(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const source = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
  const target = path.join(root, 'public/models/face-api');
  await mkdir(target, { recursive: true });
  for (const model of MODELS) {
    for (const file of [`${model}-weights_manifest.json`, `${model}.bin`]) {
      await copyFile(path.join(source, file), path.join(target, file));
    }
  }
  console.log(`Face models: ${MODELS.length} networks copied to public/models/face-api.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyFaceModels(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
