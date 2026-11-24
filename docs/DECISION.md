# Decisions

Product and architecture decisions for the Twake n8n nodes, newest last. A decision changes only by a
new entry that says what it replaces.

Status: **decided** (given by the product owner), **proposed** (a proposal, to confirm), **open**.

Every heading, `##` and `###`, carries the date of its decision, and of each update, in its
parentheses: `grep -nE '^#{2,3} .*2026-11-09' docs/DECISION.md` lists what one day decided or changed.

## D1. A monorepo of n8n nodes for the Twake Workplace apps (decided, 2026-11-05)

One repository, `linagora/twake-n8n-nodes`, with one folder per npm package under `packages/`.

## D2. One node per Twake app, eight in all (decided, 2026-11-05; changed by D15, 2026-11-12, and D18, 2026-11-23)

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

## D10. Eight packages, each with one node and one credential (decided, 2026-11-09; changed by D15, 2026-11-12, and D18, 2026-11-23)

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

## D14. The n8n admin presets the SSO client with credential overwrites (proposed, 2026-11-10)

Users neither register an OIDC client nor copy its secret. The admin of each n8n instance registers one
`n8n` client on the SSO, with the redirect URL of that instance, and loads its client ID and secret, the
SSO URL and the fixed service URLs through n8n's credential overwrites. On n8n hosted by Twake, Linagora
does this for each deployment.

n8n hides those fields and Drive, Settings and Home read the instance from the SSO, so a user only
clicks **Connect** on each of the seven SSO-based nodes. D10 still means one login per node, and Chat
stays apart until D11 is settled.

The client cannot ship in the packages: a secret in an npm package is public, and the redirect URL is
tied to one n8n host. See [AUTHENTICATION.md](AUTHENTICATION.md#preset-sso-client).

## D15. Home and Settings are one Account node (decided, 2026-11-12; changes D2 and D10)

Home and Settings share cozy-stack as their backend and mean almost the same thing to a user, so two
nodes made no sense. One package, `n8n-nodes-twakeaccount`, has the **Twake Account** node and its
credential. It replaces `n8n-nodes-twakehome` and `n8n-nodes-twakesettings`, which were never
published.

There are now seven nodes and seven packages, six of them SSO-based. Where an earlier entry names
Settings or Home, read Account.

## D16. Nodes never delete for good (decided, 2026-11-16)

A delete operation moves the item to the trash of its app, and has no option to delete it for good.
A workflow, or an AI agent using a node as a tool, could otherwise destroy data with no way back.

Exception for now: **Twake Calendar > Event > Delete** deletes the event for good, as Twake Calendar
has no trash for events.

## D17. Twake Chat logs in through the SSO with Synapse's JWT login (decided, 2026-11-16; settles D11)

The Chat credential is an SSO credential like the others, `twakeChatOAuth2Api`, and the user no longer
pastes a Matrix token. Synapse accepts the SSO id_token at its JWT login, as Chat mobile does, and n8n
trades it for a Matrix token on a fixed `N8N` device. See
[AUTHENTICATION.md](AUTHENTICATION.md#login-to-matrix).

Each Synapse must list the n8n SSO client in `jwt_config.audiences`. To end access, revoke the login at
the SSO, which ends the cached Matrix token within the hour, then log out the Matrix device, which ends
that token at the homeserver. Logging out the device alone only lasts until the next login.

## D18. Triggers come from the webhook gateway, in the package of their app (decided, 2026-11-23; changes D2 and D10)

A trigger node subscribes its webhook URL at the Twake webhook gateway (ADR 075) with the user's SSO
token, and never polls the backend. The gateway sends signed calls that carry ids only, and the node
reads the object from its app with the same token, so the app's permissions decide what it sees.

The trigger of an app sits in that app's package, next to its action node, and uses the same
credential: a package now has one action node, at most one trigger node, and one credential. The
"one node per Twake app" of D2 counts the action nodes. The credential gets an optional **Webhook
Gateway URL**, preset by the admin like the others (D14). The trigger's technical name is the action
node's plus `Trigger`, such as `twakeTasksNodeTrigger`: n8n only shows the action node and the
trigger as one app in its node panel when the names match this way.

First, **Twake Tasks Trigger**, as Twake Tasks is the only app that publishes what a trigger needs.

## D19. Packages are public, under the `@linagora` scope on npm (decided, 2026-11-24)

The repository is public and each package is published to the public npm registry as
`@linagora/n8n-nodes-twake…`, such as `@linagora/n8n-nodes-twakedrive`. A scoped name is valid for
n8n's verification, so D9 stays the target and the names do not change on the way to it. The folders
under `packages/` keep their unscoped names.

Every package starts at 0.1.0 under its scoped name, Drive included, and stays below 1.0.0 until a
decision moves it there. Releases work as in twake-libs and twake-ui: on each push to `main`,
`multi-semantic-release` sets the version of each changed package from its commits and publishes it.
Below 1.0.0 a breaking change releases a minor version.

An n8n hosted by Twake installs the packages from npm at start, for every user of the instance, and
they are not installed from the editor. Node types carry the package name, such as
`@linagora/n8n-nodes-twakedrive.twakeDriveNode`.
