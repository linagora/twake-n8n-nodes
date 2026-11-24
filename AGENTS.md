# Twake n8n nodes

Monorepo of n8n community nodes for the Twake Workplace apps. Each package under `packages/` is one
npm package.

## Documents

- [docs/DECISION.md](docs/DECISION.md): the product and architecture decisions. Read it before
  changing either. A new decision is a new entry at the end, with its status and date, and a decision
  changes only by a new entry that says what it replaces.
- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md): the current state and options for logins, tokens
  and revocation. Read it before touching a credential, and update it when that state changes.

## Commands

Requires Node.js 24.

```bash
npm install
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run n8n
```

`npm run n8n` runs a local n8n at http://localhost:5678 with the packages of this repository.

## Rules for packages

The target is n8n verification (D9).

- One package has one action node, at most one trigger node, and one credential (D10, D18).
- A node only references credentials declared by its own package, and a credential name is unique
  across the repository.
- No runtime dependencies, and no access to the environment or to files.
- Follow n8n's [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines).
  User-facing text is in English.
- No permanent delete: a delete moves to the trash of the app (D16).
- A change that breaks existing nodes or credentials has a `BREAKING CHANGE:` footer in its commit,
  saying what the user must do. It goes to the `CHANGELOG.md` of the package.
- `stackToken.ts` is copied into each cozy-stack package, as packages cannot depend on each other. The
  copies stay identical.

## Developing

When developing or updating a node, always test it in the user's Chrome (Claude in Chrome), where n8n
is signed in and the credentials are connected. Do not use a built-in or headless browser instead.

## Publishing

Packages are published to npm under the `@linagora` scope (D19), the way twake-libs and twake-ui are.
On each push to `main`, `multi-semantic-release` releases every package changed since its last tag: it
sets the version from the commits, writes the `CHANGELOG.md` of the package, publishes to npm, tags
`@linagora/n8n-nodes-twakedrive@0.2.0` and commits the version.

- The type of a commit sets the version of the packages whose files it changes: `fix` is a patch,
  `feat` a minor. Other types release nothing.
- Below 1.0.0 a breaking change is a minor version, by the `releaseRules` of `.releaserc.json`. Going
  to 1.0.0 is a decision: remove that rule, and the next breaking change releases 1.0.0.
- Never set a version by hand, and never run `npm run release` locally: it publishes for real.

## Secrets

Client secrets, tokens and dev credentials never go in git, in these documents or in logs.