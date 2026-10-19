# Preparing a Windows release

The public release is built from a committed, verified checkout. It contains no local project indexes, models, secrets, or unrelated `.artifacts` data. The npm package is distributed as a release tarball; this procedure does not publish it to the npm registry.

1. Align `package.json`, the two root versions in `package-lock.json`, `src/version.ts`, and the bootstrap's bundled tarball/version checks. Update the English/Russian entry points, install guide, release notes, and announcement draft.
2. Run `npm ci` and `npm run compile` using a supported Node.js. Stage regenerated `dist/src/` and `dist/viewer/` with source changes, then run `npm run verify` and `npm run plugin:smoke`. `package:check` rejects missing/stale artifacts. Keep install/build lifecycle scripts absent; compile is a developer command. Review `npm pack --dry-run --json`; only the package allowlist should be included.
3. Commit the verified files. With that supported Node.js on `PATH`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package_release.ps1 -OutputDirectory 'D:\release-output\CM-0.9.1'
```

The output directory must be new. The packager refuses uncommitted files and stale compiled versions. It records the exact commit, creates `CM-0.9.1-Windows.zip`, and emits the npm tarball, `release-manifest.json`, and `SHA256SUMS.txt`. ZIP contents have a separate internal checksum list. The external list covers the ZIP, tarball, and manifest.

4. Extract the ZIP outside the checkout and run its bootstrap on a disposable JavaScript/TypeScript project. Verify version, generated Harness profile, MCP doctor, retrieval, and unchanged project source. Also install the exact Git commit in a clean directory with scripts disabled; check runtime import, CLI, and bundled Atlas. Test `dsh plugin ... add github:kobubu/Rag-Coding#COMMIT` in an isolated Harness profile. Do not use a cached package as proof of the new ZIP.
5. Push the exact tested commit. Check its Windows/Linux, Node 22/24 CI jobs. Create a draft release for that commit, upload the four output files, and compare downloaded asset hashes before publishing the release.
6. Verify the published tag resolves to the intended commit, the release is public, and anonymously downloaded assets match the checksums. Repository description/topics come from [repository-metadata.json](repository-metadata.json).

The [published Show Your Plugins post](announcements/v0.9.0-show-your-plugins.md) preserves the original 0.9.0 announcement. A new release does not automatically update that post or the catalogue's pinned tarball. Preserve old tags and announcements; future announcements must retain the unofficial-project notice and benchmark limitations.
