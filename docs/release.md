# Repository and release workflow

## Remotes

Maintainer checkouts use three remotes:

```text
origin     https://github.com/GuanceDemo/observability-demo.git
truewatch  https://github.com/TrueWatchTech/observability-demo.git
personal   https://github.com/cherrycove/observability-demo.git
```

The local `main` branch tracks `personal/main`, and the default push remote is
`personal`. The Guance repository is the canonical public source cloned by the
Workshop. The personal repository is the only Harbor image publisher. The
TrueWatch repository preserves its independent history and remains unchanged.

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
3. Create the SemVer tag and push it to `personal`. Only the personal repository
   is allowed to publish Harbor images.
4. Verify the four Harbor manifests and their target platforms, Helm profile,
   SourceMap package, and workshop contract.
5. Push the same tag, pointing to the same commit, to `origin` so Workshop users
   can clone the immutable Guance release.
6. Publish the matching Workshop update. Leave the TrueWatch repository
   unchanged.

Never force-push `truewatch/main` or merge the unrelated Guance/personal and
TrueWatch histories. No TrueWatch synchronization is part of this release.

## Version contract

For release `v2.3.0`, all user-visible deployment artifacts use `2.3.0`:

- Helm Chart `version` and `appVersion`
- Harbor image tag and `DD_VERSION`
- RUM Version
- Web SourceMap archive and upload Version
- Workshop Git clone tag

The release workflow may continue to publish compatibility tags, but Workshop
instructions must always use the immutable full version.
