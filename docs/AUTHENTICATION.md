# Authentication

Current state of authentication in this repository, as of 2026-11-12. The choices behind it are in [DECISION.md](DECISION.md).

Measurements come from the dev environment on 2026-11-09, with n8n 2.46.6. Client secrets and tokens
never go in this file.

## Twake Drive

Twake Drive calls cozy-stack with a stack token obtained from `/auth/token_exchange`. Its credential is
`twakeDriveOAuth2Api`. Reads are tested on dev, and writes are refused until the n8n app manifest
allows them.

Its trigger, **Twake Drive Trigger**, cannot send the stack token to the Twake webhook gateway: it
refreshes an SSO access token with the refresh token of the credential, caches it while it lasts, and
sends that one. The stack names the owner of a file by the `uuid` claim, which it keeps at the token
exchange, so the id_token must carry it. Tested on the devbox on 2026-11-23 with the preset `n8n`
client, its id_token forced to carry `uuid` and `workplaceFqdn`: publishing the workflow subscribes,
a file uploaded to the drive starts it, and the node reads the file with the stack token.

## Twake Mail

Twake Mail calls the JMAP server directly with the SSO access token (D8), which must carry the
`james` audience. Its credential is `twakeMailOAuth2Api`. Tested on dev on 2026-11-12: the token is accepted.

## Twake Contacts

Twake Contacts calls the calendar side service directly with the SSO access token (D8), which must
carry the `openpaas` audience. Its credential is `twakeContactsOAuth2Api`. Not tested on dev yet.

## Twake Chat

Twake Chat calls the Matrix homeserver with a Matrix access token obtained from Synapse's JWT login
with the SSO id_token (D17). Its credential is `twakeChatOAuth2Api`. Tested on dev on 2026-11-16 with a
preset SSO client, once the `n8n` client was added to the `jwt_config.audiences` of Synapse: the login
is accepted, sending, editing and reacting work, and three runs used one `n8n` device. Before that
change, Synapse answered `Invalid claim 'aud'`.

## Twake Tasks

Twake Tasks calls its backend directly with the SSO access token (D8), which must carry the
`twaketasks` audience. Its credential is `twakeTasksOAuth2Api`. Tested on dev on 2026-11-12 with a
preset SSO client: the token is accepted, and the project and task operations answered.

Its trigger, **Twake Tasks Trigger**, also sends the token to the Twake webhook gateway, which must
find its own audience, `twake-webhook-gateway` on dev, and the person's `uuid` and `org_id` in
userinfo. Tested on the devbox on 2026-11-23 with a preset SSO client whose additional audiences are
`twaketasks twake-webhook-gateway`: publishing the workflow subscribes, a task created starts it,
and the node reads the task with the same token.

## Twake Account

Twake Account calls cozy-stack with a stack token obtained from `/auth/token_exchange`, like Twake
Drive (D7). Its credential is `twakeAccountOAuth2Api`. Tested on dev on 2026-11-12 with a preset SSO
client (D14): the credential connected with only **Connect**, and both operations answered.

## Login

1. An admin registers one confidential OIDC client on LemonLDAP, `n8n`, with the
   `openid profile email offline_access` scopes and the n8n redirect URL,
   `https://<n8n host>/rest/oauth2-credential/callback`.
2. The credential extends n8n's `oAuth2Api`. The user clicks **Connect**, which runs the
   authorization code flow, after filling in the URLs, the client ID and the client secret unless the
   admin preset them.
3. n8n stores the access, id and refresh tokens encrypted in its database.

## Preset SSO client

An n8n admin can preset the client with n8n's
[credential overwrites](https://docs.n8n.io/administer/manage-credentials/credential-overwrites)
(D14). n8n hides the overwritten fields, and Drive and Account read the instance from the SSO,
so the user only clicks **Connect**.

1. Start n8n with `CREDENTIALS_OVERWRITE_ENDPOINT`, `CREDENTIALS_OVERWRITE_ENDPOINT_AUTH_TOKEN` and
   `CREDENTIALS_OVERWRITE_PERSISTENCE=true`. Persistence stores the overwrites encrypted in the
   database, so they survive restarts and reach every worker.
2. `POST` to that endpoint, with the token, a JSON object with one entry per credential type, such as
   `twakeDriveOAuth2Api`: `clientId`, `clientSecret` and `ssoUrl`, plus `apiUrl` for Calendar,
   Chat (the homeserver), Contacts, Mail and Tasks, and `gatewayUrl` for Tasks (the Twake webhook
   gateway, which the Twake Tasks Trigger needs). Never an entry for the parent `oAuth2Api`, which
   would apply to every OAuth2 credential of the instance.

An overwrite only fills empty fields, so existing credentials keep their values. Tested on dev on
2026-11-10 with n8n 2.46.6: Calendar and Drive connected and ran with only **Connect**. The
`CREDENTIALS_OVERWRITE_DATA` variable works too, but n8n warns that it can leak to users.

## Exchange for a stack token

cozy-stack refuses the SSO token (`400 Invalid JWT token`). The credential runs
`exchangeForStackToken` as its `preAuthentication`:

1. Look in a cache keyed by the refresh token, for one hour and per n8n process.
2. Refresh at the SSO to get a fresh `id_token`.
3. `POST <instance>/auth/token_exchange` with `{ id_token, exchange_type: 'app' }`. The instance is
   the URL filled in the credential or, when it is empty, the `workplaceFqdn` claim of that
   `id_token`. On dev the claim is there with the default scopes.
4. Refuse the answer unless its `scope` is `@io.cozy.apps/n8n`. The stack picks the app from the
   audiences of the `id_token`, so it can answer with a token for another mapped app.
5. Use the returned stack token for the request. n8n does not save it, and the node sets
   `oauth2: { skipTokenRefresh: true }`.

## Login to Matrix

Synapse refuses the SSO access token, and accepts an id_token at
`POST /_matrix/client/v3/login` with `{ type: 'org.matrix.login.jwt', token }` when its `jwt_config`
lists the client in `audiences`. The credential runs `loginToMatrix` as its `preAuthentication`:

1. Look in a cache keyed by the refresh token, for one hour and per n8n process.
2. Refresh at the SSO to get a fresh `id_token`, as Synapse refuses an expired one.
3. Log in with it on the device `N8N`. Reusing the device ID replaces the token of that device, so
   logins do not pile up devices.
4. Use the returned Matrix token for the request. n8n does not save it, and the node sets
   `oauth2: { skipTokenRefresh: true }`: on a 401, n8n would retry with the stored SSO access token,
   which must not reach the homeserver.

On a 401, the node drops the cached Matrix token and retries the request once, which logs in again.
That covers a token revoked by logging out the `N8N` device, and two n8n processes or two credentials
of one user, which replace each other's token.

Matrix tokens issued this way do not expire. To end access, revoke the login at the SSO, which stops
new logins and ends the cached token within the hour, then log out the `N8N` device, which ends the
last token at the homeserver.

## Lifetimes

| Token                                | Lifetime                      | Source                 |
| ------------------------------------ | ----------------------------- | ---------------------- |
| SSO access token, id token           | 10 hours                      | Measured               |
| SSO refresh token, `offline_access`  | 30 days, survives logout      | Internal documentation |
| SSO refresh token, no offline access | SSO session, 20 hours at most | Internal documentation |
| Stack access token                   | 7 days                        | cozy-stack code        |
| Stack token cached by the node       | 1 hour                        | `stackToken.ts`        |
| Matrix token from the JWT login      | No expiry, until replaced     | Synapse                |
| Matrix token cached by the node      | 1 hour                        | `matrixToken.ts`       |

## Scope of the tokens

On dev, the SSO access token and the id token carry 28 audiences: `n8n` and the other Twake clients,
including administration clients. The login is therefore not limited to Drive (D13).

The stack token is limited by the n8n app manifest, which is read-only for now.

## Revocation

Measured by revoking a login at the SSO:

| What                                   | Result                                     |
| -------------------------------------- | ------------------------------------------ |
| SSO refresh                            | Refused at once (400)                      |
| Existing stack token and stack refresh | Still accepted after 40 seconds            |
| Stack client                           | Survives                                   |
| New exchange with the old `id_token`   | Accepted, as the `id_token` lasts 10 hours |

Other paths:

- Removing the client in **Twake Settings > Connected devices** only lasts until the next exchange,
  within the hour, which creates a new client.
- Deleting the credential in n8n does not revoke anything at the SSO.

To end access, revoke the login at the SSO. The node can keep using a cached stack token for up to an
hour.

## Target against current state

| Criterion                            | State                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| Login through the SSO in n8n         | Done                                                     |
| Permissions limited by app           | Stack token only, the SSO token is not limited (D13)     |
| Permissions limited inside an app    | Through the n8n app manifest                             |
| Revocable by the user                | Partly, at the SSO, with no dedicated user interface yet |
| Revocation chain to exchanged tokens | No (D12)                                                 |
| Long-lived offline access            | Yes, within the refresh token lifetime                   |

## What n8n allows

- A node can only use credentials its own package declares. The `no-credential-reuse` lint rule has
  no exceptions, and n8n's scanner ignores `eslint-disable` comments.
- `extends = ['oAuth2Api']` is allowed. It reuses the OAuth2 form and logic, not a stored login.
- What `preAuthentication` returns is not saved here, which is why `stackToken.ts` has its own cache.

## Options not in use

| Option                                                  | What it would give                  | Why not now                                             |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| Per-instance stack OAuth client (`/auth/register`)      | Direct stack login, no SSO client   | Replaced by the exchange (D7)                           |
| `POST <instance>/oidc/access_token`                     | Trade the SSO token for a stack one | Answers `this endpoint is not enabled` on dev           |
| One audience per token, or an SSO exchange per audience | Permissions limited by app          | Not validated on the SSO (D13)                          |
| Dynamic client registration                             | No client secret to copy            | Not documented for custom credentials, needs stack work |
| Device flow                                             | Login without a redirect            | The dev SSO answers `unsupported_grant_type`            |
