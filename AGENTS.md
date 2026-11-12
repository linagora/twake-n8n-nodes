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

- One package has one node and one credential (D10).
- A node only references credentials declared by its own package, and a credential name is unique
  across the repository.
- No runtime dependencies, and no access to the environment or to files.
- Follow n8n's [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines).
  User-facing text is in English.
- A change that breaks existing nodes or credentials goes in the version history of the package README.
- `stackToken.ts` is copied into each cozy-stack package, as packages cannot depend on each other. The
  copies stay identical.

## Developing

When developing or updating a node, test it on a real browser like Chrome.

## Publishing

Publishing is disabled. Do not enable it unless asked.

## Secrets

Client secrets, tokens and dev credentials never go in git, in these documents or in logs.