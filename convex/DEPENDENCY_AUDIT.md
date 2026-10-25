# Dependency audit follow-up

The production dependency audit was inspected on October 24, 2026 under Node 24.22.1, without modifying the root package manifest or lockfile. `npm audit --omit=dev --json` reported five high-severity package entries and no critical entries.

## Findings

The five package entries are `node-forge`, `zod`, `@expo/code-signing-certificates`, `@expo/cli`, and `expo`. The last three are transitive vulnerability propagation; the report identifies two underlying advisories.

- **node-forge:** Installed version 1.4.0 is affected by RSA PKCS#1 v1.5 signature verification accepting extra nested DigestAlgorithm elements; the reviewed advisory lists all versions through 1.4.0 and no patched release ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)). The npm registry check returned 1.4.0 as the newest published version during this inspection.
- **Zod:** Installed version 3.25.76 is in the advisory's affected range below 4.6.6, and the documented fix is 4.6.6 or later ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)). The npm registry check returned 4.6.7 as latest, while the newest 3.x release remained 3.25.76.

The installed dependency path is `expo@58.0.19 → @expo/cli@58.1.15`, with CLI dependencies `node-forge:^1.4.0`, `@expo/code-signing-certificates:^0.0.7`, and `zod:^3.25.76`. The certificate package also requires `node-forge:^1.4.0`.

The audited source paths belong to development/build tooling: Expo certificate signing/verification and DevTools/MCP schema validation. No direct imports of these vulnerable packages were found in `src`, `convex`, or the local native modules; this narrows the observed path but does not establish that the project or release workflow is unaffected.

## Recommendation

There is currently no verified semver-compatible dependency update that removes both underlying advisories. Keep the unresolved findings visible rather than claiming the audit is clean.

- **Do not force the audit suggestion:** The report proposes `expo@44.0.6`, a major downgrade, not an SDK 58-compatible repair. Expo SDK 58 targets React Native 0.88 and React 19.3, so changing Expo across that boundary is not a safe isolated security fix ([Expo SDK 58 compatibility reference](https://docs.expo.dev/versions/v58.0.0/)).
- **Do not blindly override Zod:** Forcing 4.6.7 changes the major version outside Expo CLI's declared `^3.25.76` range and can also affect the lint toolchain. A scoped override is only a candidate after explicit compatibility testing of Expo start, export, prebuild, signing, DevTools, and lint; it would still leave node-forge unresolved.
- **Do not invent a node-forge patch version:** The reviewed advisory lists no patched release, so neither a normal update nor a known-good published override was available at inspection time ([node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)). A future upstream fix or independently reviewed patch would need a separate security review and regression test.
- **Contain development exposure:** Keep development servers local/private, avoid untrusted DevTools plugins and signing inputs, and keep build credentials isolated. These are risk-reduction measures, not vulnerability remediation.
- **Recheck before distribution:** Re-run the audit when compatible Expo/tooling updates are released and before any public release. Install SDK packages using Expo's compatibility-aware installer rather than an indiscriminate major-version audit fix ([Expo SDK package guidance](https://docs.expo.dev/versions/v58.0.0/)).

## Upload cancellation finding

The backend correctly gates model processing and recap publication on both exchange confirmations. Uploading after recording ends but before exchange is permitted, and that alone does not contact the model provider.

A signed upload already in flight can complete after cancellation or deletion. `attachAudio` then rejects the attachment, and the resulting orphan object is removed after it reaches 15 minutes of age by the five-minute cleanup sweep; cancellation is not instantaneous deletion of an unattached in-flight upload.

The frontend should serialize automatic and manual upload attempts with a shared in-flight promise or operation guard, invalidate pending work on cancellation/unmount, and abort the transfer where the upload transport supports it. An arbitrary client-supplied storage-ID deletion endpoint is not a safe shortcut without a securely bound upload-ownership record.

Regression tests exercise both cancellation and deletion races, verify that no processing job can claim the file, and verify eventual orphan deletion. These tests supplement the existing attached-audio cancellation and deletion tests.
