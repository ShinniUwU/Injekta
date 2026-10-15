# Contributing to Injekta

Thanks for wanting to help. Injekta handles health data, so privacy comes first in every change.

## Before you start

- Open an issue for anything bigger than a small fix, so we can agree on it first.
- Read the Privacy section of the [README](README.md). A change must not weaken it: no logging of doses, medication or legs, no way for admins to see someone's logs without that person's permission, and no extra data stored.

## Setup

```bash
bun install
bun run dev
```

You need a Discord bot token in your own `.env`. Never commit it.

## Before you open a PR

Run all of these and make sure they pass:

```bash
bun run lint
bun run prettier-check
bun run test
bun run build
```

- Add or update tests for behavior changes.
- Keep commits short and specific, using Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Match the existing style and patterns in `src/`.

## Licensing of contributions

Injekta uses the [PolyForm Noncommercial License 1.0.0](LICENSE). By submitting a contribution you agree that:

1. It is licensed under that same license.
2. The project owner may also license it under other terms, including commercial licenses.

If you don't agree with that, please don't submit a PR.

## Security issues

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
