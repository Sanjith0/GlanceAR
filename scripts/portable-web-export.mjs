import { readdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function portableReferences(text) {
  return text
    .replaceAll('/assets/node_modules/', '/assets/vendor/')
    .replace(/(["'])\/(_expo\/|assets\/|favicon\.ico)/g, '$1./$2');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(filename));
    else files.push(filename);
  }
  return files;
}

export async function makePortableExport(outputDirectory) {
  const dependencyAssets = path.join(outputDirectory, 'assets/node_modules');
  try {
    await access(dependencyAssets);
    // Many static artifact uploaders intentionally omit node_modules directories.
    // These are exported font/image assets, not dependencies.
    await rename(dependencyAssets, path.join(outputDirectory, 'assets/vendor'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let changed = 0;
  for (const filename of await walk(outputDirectory)) {
    if (!/\.(?:html|js|css|json)$/.test(filename)) continue;
    const original = await readFile(filename, 'utf8');
    const portable = portableReferences(original);
    if (portable !== original) {
      await writeFile(filename, portable);
      changed++;
    }
  }
  console.log(`Portable web export: relative references in ${changed} files; dependency assets under assets/vendor.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await makePortableExport(path.resolve(process.argv[2] ?? 'dist'));
}
