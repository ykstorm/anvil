# Contributing to Anvil

Thanks for your interest in Anvil, the idempotent webhook to BullMQ pipeline.
Contributions are welcome, whether it's a bug fix, a test, a docs improvement, or
a new deploy target.

## Getting started

Anvil is a pnpm monorepo (server + worker + SDK). You need Node 20+, pnpm, and a
Redis instance.

```bash
git clone https://github.com/ykstorm/anvil.git
cd anvil
pnpm install
pnpm -r build

# Redis in one line (for the worker + server)
docker run -p 6379:6379 redis:7
```

Run the test suite:

```bash
pnpm -r test
```

## Development workflow

- Branch off `main`: `git checkout -b fix/short-description`.
- **Write a test for every behaviour change.** The five core contracts (one job
  per delivery, constant-time signature check, fixed retry backoff, manual
  dead-letter replay, small SDK surface) each have tests, keep them green and
  add to them.
- Run `pnpm -r lint` and `pnpm -r test` before pushing.
- Keep the SDK surface small: `createServer`, `createWorker`, `replayDeadLetter`.
  New public exports should be discussed in an issue first.

## Submitting a pull request

1. Push your branch to a fork.
2. Open a PR against `main` with a clear description of the problem and the fix.
3. Link any related issue.
4. Make sure CI (lint + typecheck + build + test) is green.

## Publishing to npm

Releases are published from CI when a `v*` tag is pushed. The publish job signs in to npm with a short-lived OIDC token from GitHub Actions (npm Trusted Publishing), so the repo holds no npm token.

One-time setup, done by a package owner on npmjs.com:

1. Open the package page for `@ykstormsorg/anvil` and go to Settings.
2. Under Trusted Publisher, choose GitHub Actions.
3. Set the repository to `ykstorm/anvil` and the workflow file to `ci.yml`. Use the file name only, with the extension, spelled exactly as in `.github/workflows`. Leave the environment blank.
4. Save.

The publish job has `id-token: write` permission, runs on Node 22 and installs npm 11.5.1 or newer, which npm requires for trusted publishing. npm matches the workflow file name exactly, so if the file is renamed, update the setting on npmjs.com or the publish fails.

After the first successful publish this way, delete the `NPM_TOKEN` secret from the repository (Settings, Secrets and variables, Actions) and revoke the token on npmjs.com.

## Security

Please do not open a public issue for security vulnerabilities. Anvil handles
webhook signatures and idempotency, so signature-verification or replay issues are
sensitive. Report them privately through the repository Security tab (Report a
vulnerability), which opens a private advisory, and allow time for a fix before
disclosure.

## Code style

- TypeScript, strict mode.
- Follow the patterns already in the package you're editing.
- Clear, imperative commit messages (Conventional Commits appreciated).

## Questions?

Open a GitHub issue or a discussion. Thanks for contributing!
