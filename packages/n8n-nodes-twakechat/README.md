# n8n-nodes-twakechat

n8n community node to read the Matrix account of a [Twake Workplace](https://twake.app/) user.

## Operations

- **Account > Get**: the `user_id` and `device_id` of the connected Matrix account.

## Usage

Set up the credential and add the node. It outputs one item per input item.

Example workflow:

1. **Manual Trigger**.
2. **Twake Chat**, **Account > Get**.
3. **Edit Fields**, keeping `{{ $json.user_id }}`.

## Credentials

The node uses the **Twake Chat OAuth2 API** credential, which logs in through the Twake SSO. n8n
trades the id_token of that login for a Matrix access token at Synapse's JWT login
(`org.matrix.login.jwt`), on a Matrix device named `n8n` with the ID `N8N`. A new login replaces the
token of that device.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential.
2. In the Synapse configuration, accept the id_tokens of this client:

   ```yaml
   jwt_config:
     enabled: true
     secret: <public signing key of the SSO>
     algorithm: RS256
     issuer: https://sign-up.example.com/
     audiences: [twake-chat-mobile, n8n]
     subject_claim: preferred_username
   ```

   Without the client in `audiences`, Synapse answers `Invalid claim 'aud'`.

3. In the credential, fill in the homeserver URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To end access, revoke the login at the SSO. Logging out the `n8n` device in Twake Chat only lasts until
the next request, which logs in again.
