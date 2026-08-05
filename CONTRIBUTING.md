# Contributing to Anvil

Thanks for your interest in Anvil — the idempotent webhook → BullMQ pipeline.
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
  dead-letter replay, small SDK surface) each have tests — keep them green and
  add to them.
- Run `pnpm -r lint` and `pnpm -r test` before pushing.
- Keep the SDK surface small: `createServer`, `createWorker`, `replayDeadLetter`.
  New public exports should be discussed in an issue first.

## Submitting a pull request

1. Push your branch to a fork.
2. Open a PR against `main` with a clear description of the problem and the fix.
3. Link any related issue.
4. Make sure CI (lint + typecheck + build + test) is green.

## Security

Please do **not** open a public issue for security vulnerabilities. Anvil handles
webhook signatures and idempotency, so signature-verification or replay issues are
sensitive — email raolakshyaraj@gmail.com instead and allow time for a fix before
disclosure.

## Code style

- TypeScript, strict mode.
- Follow the patterns already in the package you're editing.
- Clear, imperative commit messages (Conventional Commits appreciated).

## Questions?

Open a GitHub issue or a discussion. Thanks for contributing!
