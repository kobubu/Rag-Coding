# Preparing a Windows release

The public release is built from a committed, verified checkout. It contains no local project indexes, models, secrets, or unrelated `.artifacts` data. The npm package is distributed as a release tarball; this procedure does not publish it to the npm registry.

1. Align `package.json`, the two root versions in `package-lock.json`, `src/version.ts`, and the bootstrap's bundled tarball/version checks. Update the English/Russian entry points, install guide, release notes, and announcement draft.
2. Run `npm ci`, `npm run verify`, and `npm run plugin:smoke` using a supported Node.js. Review `npm pack --dry-run --json`; only the package allowlist should be included.
3. Commit the verified files. With that supported Node.js on `PATH`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package_release.ps1 -OutputDirectory 'D:\release-output\CM-0.9.0'
```

The output directory must be new. The packager refuses uncommitted files and stale compiled versions. It records the exact commit, creates `CM-0.9.0-Windows.zip`, and emits the npm tarball, `release-manifest.json`, and `SHA256SUMS.txt`. ZIP contents have a separate internal checksum list. The external list covers the ZIP, tarball, and manifest.

4. Extract the ZIP to a new directory outside the checkout and run its bootstrap on a disposable JavaScript/TypeScript project. Verify the installed version, generated Harness profile, MCP `doctor`, retrieval, and unchanged project source. Do not use a cached old package as proof of the new ZIP.
5. Push the exact tested commit. Check its Windows/Linux, Node 22/24 CI jobs. Create a draft release for that commit, upload the four output files, and compare downloaded asset hashes before publishing the release.
6. Verify the published tag resolves to the intended commit, the release is public, and anonymously downloaded assets match the checksums. Repository description/topics come from [repository-metadata.json](repository-metadata.json).

The [Show Your Plugins draft](announcements/v0.9.0-show-your-plugins.md) is a separate publication. Preparing a GitHub Release does not submit a community post. Include a real screenshot of the local application and preserve the unofficial-project notice and benchmark limitations when copying the draft.
