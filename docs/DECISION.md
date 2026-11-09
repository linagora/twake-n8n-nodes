# Decisions

Product and architecture decisions for the Twake n8n nodes, newest last. A decision changes only by a
new entry that says what it replaces.

Status: **decided** (given by the product owner), **proposed** (a proposal, to confirm), **open**.

Every heading, `##` and `###`, carries the date of its decision, and of each update, in its
parentheses: `grep -nE '^#{2,3} .*2026-11-09' docs/DECISION.md` lists what one day decided or changed.

## D1. A monorepo of n8n nodes for the Twake Workplace apps (decided, 2026-11-05)

One repository, `linagora/twake-n8n-nodes`, with one folder per npm package under `packages/`.

## D2. One node per Twake app, eight in all (decided, 2026-11-05)

| Node     | Backend                     |
| -------- | --------------------------- |
| Drive    | cozy-stack                  |
| Settings | cozy-stack                  |
| Home     | cozy-stack                  |
| Mail     | tmail-backend (JMAP)        |
| Calendar | twake-calendar-side-service |
| Contacts | twake-calendar-side-service |
| Chat     | Matrix and tom-server       |
| Tasks    | twake-tasks                 |

Calendar and Contacts use the side service rather than esn-sabre, which refuses the SSO token.

## D3. First scope (decided, 2026-11-05; Calendar added 2026-11-09)

Twake Drive has the same features as the
[`cozy/n8n-nodes-twakedrive`](https://github.com/cozy/n8n-nodes-twakedrive) POC. Twake Settings only
reads the disk usage. Twake Calendar only lists the calendars of the user, to try the login without
exchange.

## D4. Cozy-stack OAuth clients for the first tests (decided, 2026-11-05; replaced by D7)

The first credentials used an OAuth client created per instance. It only covers cozy-stack apps.

## D5. What good authentication means here (decided, 2026-11-05)

Permissions limited by app and inside an app, and access the user can revoke.

## D6. Target for the login (decided, 2026-11-05)

- OIDC login in n8n, with a token for the `n8n` audience.
- A whitelist of the applications linked to the n8n token.
- An unlimited offline token, revocable by the user in a good interface, and a revocation chain so
  that revoking it also revokes every token exchanged from it.

D8 uses a simpler token on dev. D12 and D13 track what is missing.

## D7. Cozy-stack nodes use `/auth/token_exchange` (decided, 2026-11-05; replaces D4)

Drive, Settings and Home trade the SSO login for a stack token at each use. See
[AUTHENTICATION.md](AUTHENTICATION.md).

### D7a. The exchange goes through the n8n app (decided, 2026-11-09)

The exchange uses the [n8n app](https://github.com/linagora/n8n-app-wrapper), so its manifest sets the
permissions. The manifest is read-only for now and will be extended by the product owner.

## D8. One OIDC client on dev, whose token has every Twake audience (decided, 2026-11-09)

Proposed by a colleague and accepted for dev: one `n8n` client on LemonLDAP. Mail, Calendar, Contacts
and Tasks are called directly with its token, with no exchange. Whether this holds beyond dev is D13.

## D9. Nodes are verified community nodes (decided, 2026-11-09)

The target is n8n's verification: listed in the nodes panel and available on n8n Cloud. Packages follow
its rules: `n8n-node` tooling, no runtime dependencies, no environment or file access, MIT, English,
publication from GitHub Actions with provenance.

## D10. Eight packages, each with one node and one credential (decided, 2026-11-09)

n8n's rule is one third-party service per package, and `no-credential-reuse` forbids a package from
using another package's credential, with no exception. So verified packages cannot share a login: a
user signs in once per node.

One package with one credential, as the built-in AWS nodes do, would give a single login. It needs n8n
to accept Twake Workplace as one service, and moving to it later would break existing nodes.

## D11. Login for Twake Chat (open, 2026-11-09)

Synapse refuses the SSO token. A LemonLDAP plugin may help, to be looked at when Chat is built.

## D12. Revocation chain (open, 2026-11-09)

Revoking at the SSO does not end the exchanged stack token, nor the access tokens already issued. D6
asks for a chain. See [AUTHENTICATION.md](AUTHENTICATION.md#revocation).

## D13. One token for every app beyond dev (open, 2026-11-09)

On dev the token opens every app the user can reach, administration clients included. D5 and D6 ask for
limits by app. To settle with the SSO team before production.
