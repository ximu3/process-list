# Releasing

Releases use `.github/workflows/publish.yml`. The workflow validates the tag, captures its commit SHA, runs the same build and verification workflow used by pull requests, assembles eight native packages, publishes those packages, then publishes the main package and GitHub release.

## Prepare

1. Set the intended version in `package.json`.
2. Run `pnpm version:sync`, then `cargo check` to update the Rust manifest and lockfile.
3. Add `changelog/vX.Y.Z/en.md` and any translated release notes.
4. Run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm check`.
5. Review the changes and complete the [desktop acceptance checks](verification.md).
6. Commit the release files and create the matching `vX.Y.Z` tag. Pushing that tag starts publication. Prereleases use npm's `next` tag; stable versions use `latest`.

The release version must agree in both manifests. All eight artifacts must be present and nonempty before assembly creates publishable packages. Generated Node-API declarations are checked against the committed declarations during builds.

## npm setup

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `ximu3/process-list`, workflow `publish.yml`, on the main package and all platform packages named in `native/targets.js`. New package names may need an initial publication under an authorized npm account before their trusted-publisher configuration can be created. This account setup is separate from changing repository code.

The workflow uses short-lived GitHub OIDC credentials and npm provenance. It has no long-lived npm token. The main and platform packages use the same exact version. The source manifest is private; assembly removes this development flag and adds the optional native dependencies in the distribution manifests under `npm/`.

## Inspect an assembly

Download all `native-*` workflow artifacts into `artifacts/`, with the `.node` files directly inside that directory:

```sh
pnpm packages:assemble
```

This prepares `npm/main/` and one directory for each native target. Assembly performs no publication. The release workflow invokes `scripts/publish.mjs` only after validation succeeds.

Publication across multiple npm packages is not atomic. If a release fails partway, inspect the already published versions before proceeding; npm versions are immutable. The script stops on the first failure and does not overwrite or silently skip an existing package. Resolve an incomplete release deliberately under the npm account, or prepare a new version. Do not retag a published version to different source.
