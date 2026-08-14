# Repository and release workflow

## Remotes

Maintainer checkouts use three remotes:

```text
origin     https://github.com/GuanceDemo/observability-demo.git
truewatch  https://github.com/TrueWatchTech/observability-demo.git
personal   https://github.com/cherrycove/observability-demo.git
```

The local `main` branch tracks `personal/main`, and the default push remote is
`personal`. The Guance repository is the canonical public and release source.
The TrueWatch repository preserves its independent history.

Configure an existing checkout with:

```bash
git remote rename origin personal
git remote rename official truewatch
git remote add origin https://github.com/GuanceDemo/observability-demo.git
git branch --set-upstream-to=personal/main main
git config remote.pushDefault personal
git config branch.main.pushRemote personal
git fetch --all --prune
```

## Release sequence

1. Merge and verify the release commit on `personal/main`.
2. Fast-forward the identical commit to `origin/main`.
3. Create the SemVer tag in the Guance repository. Only that repository is
   allowed to publish Harbor images.
4. Verify the four Harbor manifests, Helm profile, SourceMap package, and
   workshop contract.
5. Create `sync/v<version>` from `truewatch/main`, replace its tracked content
   with the Guance tag tree, and open a normal pull request.
6. After the TrueWatch pull request merges, create the same semantic tag on its
   merge commit. Commit IDs may differ; the tracked trees must not.

Never force-push `truewatch/main` and never merge the unrelated Guance/personal
and TrueWatch histories.

## Version contract

For release `v2.3.0`, all user-visible deployment artifacts use `2.3.0`:

- Helm Chart `version` and `appVersion`
- Harbor image tag and `DD_VERSION`
- RUM Version
- Web SourceMap archive and upload Version
- Workshop Git clone tag

The release workflow may continue to publish compatibility tags, but Workshop
instructions must always use the immutable full version.
