# n8n-nodes-twakechat

n8n community node to send, edit and react to messages in the Matrix rooms of a
[Twake Workplace](https://twake.app/) user.

## Operations

- **Account > Get**: the `user_id` and `device_id` of the connected Matrix account.
- **Message > Send**: sends a text, with an optional HTML version, to a room. Outputs its `event_id`.
- **Message > Send File**: uploads the file of an input binary field and sends it to a room, as an
  image, audio, video or file from its MIME type. The homeserver refuses a file over its size limit or
  quota.
- **Message > React**: adds a reaction, such as an emoji, to a message.
- **Message > Edit**: replaces the text of a message. Clients only show the edit on a message you sent.

A room is given by its ID (`!…:server`), not its alias. A message is given by its `event_id`.

The node has no end-to-end encryption. In an encrypted room, its messages are sent unencrypted, and
other clients mark them so.

## Usage

Set up the credential and add the node. It outputs one item per input item.

Example workflow:

1. **Manual Trigger**.
2. **Twake Chat**, **Message > Send**, with a Room ID and a Text.
3. **Twake Chat**, **Message > React**, with the same Room ID, `{{ $json.event_id }}` as Message ID and
   👍 as Reaction.

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

To end access, revoke the login at the SSO, then log out the `n8n` device in Twake Chat. The node
keeps using its Matrix token for up to an hour after the revocation, and the token stays valid at the
homeserver until that logout. Logging out the device alone only lasts until the next request, which
logs in again.
