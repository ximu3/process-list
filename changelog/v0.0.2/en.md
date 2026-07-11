# v0.0.2

## Breaking Changes

- The package is now ESM-only. CommonJS `require()` is no longer supported.

## Changed

- The native binding loader is now emitted directly as an ES module.
- Package exports now expose a single ESM entry point with TypeScript declarations.
- CI and npm publishing have been split into independent GitHub Actions workflows.
- Releases are now triggered by `v*` tags, with version and changelog validation before publishing.
- npm packages are published with trusted publishing and provenance.
- Git hooks have been migrated from Husky to Lefthook.

## Validation

- Added ESM entry-point verification and explicit rejection testing for CommonJS loading.
- Added CI coverage for Node.js 20, 22, and 24.
