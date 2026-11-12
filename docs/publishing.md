# Publishing Roteador

## One-time npm setup

1. Create or obtain ownership of the npm scope `@rodkisten`.
2. Configure **Trusted Publisher** for package `@rodkisten/roteador`:
   - Provider: GitHub Actions
   - Owner: `rodkisten`
   - Repository: `roteador`
   - Workflow filename: `publish.yml`
   - Environment: `npm-publish`
3. Create the GitHub environment `npm-publish` and restrict deployments to `main`.
4. Ensure Node and npm versions support npm Trusted Publishing.
5. Keep package versions immutable. Bump before each publication.

**Important:** npm Trusted Publishing for an existing package requires configuring the publisher
on npm. If the package does not exist, the initial bootstrap publication may require an
appropriately scoped npm token, after which configure OIDC. Do not put credentials in git.

## Release

Merge the verified PR, then run **Publish npm** from `main` with `next`.
The workflow builds and tests, rejects an existing version, publishes with provenance,
then creates a prerelease on GitHub.

To make a tested version the default, run **Promote npm release** with that version.
Promotion modifies a dist-tag; it does not rebuild or republish the package.

## CircleCI fallback

CircleCI can publish with `NPM_TOKEN` configured in a restricted CircleCI context.
Use an npm granular access token with publish permission and minimum scope.
Never run CircleCI and GitHub publication for the same version simultaneously.
The fallback requires manual approval and must not run on pull requests.

## Package scope

Only `packages/core` is publishable in v0. The Cloudflare adapter stays private.
