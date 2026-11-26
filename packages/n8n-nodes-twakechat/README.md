# @linagora/n8n-nodes-twakechat

n8n community nodes to send, edit and react to messages in the Matrix rooms of a
[Twake Workplace](https://twake.app/) user, and to start a workflow on a direct message or a mention.

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

## Trigger

The **Twake Chat Trigger** node starts a workflow on:

- **Direct Message**: a message sent in one of your direct conversations. **Sent By** picks whose:
  **Others**, the default, **Me** or **Anyone**.
- **Mention**: a message that mentions you, in any room. A mention you make does not start it.

It does not poll the homeserver. When the workflow is published, or listens for a test event, the node
subscribes its webhook URL at the Twake webhook gateway (ADR 075); when the workflow is unpublished,
it deletes the subscription. When n8n publishes the workflow again, a subscription for another URL or
for other events is replaced. Each call is signed, and the node refuses one whose signature is wrong
or older than five minutes.

The gateway sends ids only. With **Include Message** on, the default, the node reads the message with
your Matrix token and outputs it as `message`, or `null` when you cannot see it anymore. Each item
holds the event: `id`, `type`, `time`, `twakeorg`, `twakeactorid` (the uuid of the sender, absent when
Twake does not know them, such as a bot), `data.object` (the `id` of the Matrix event) and
`data.container` (the `id` of the room, and its `kind`: `direct` or `room`).

Twake Chat publishes these events only where its side service receives the events of the homeserver,
and for the messages in the clear sent from your homeserver:

- An encrypted message, an edit and a message sent from another homeserver start nothing.
- A direct conversation is a room of two people that one of them holds as direct, as Twake Chat
  shows it. One just created may take a minute to count.
- A mention is read from the `m.mentions` of the message, which Twake Chat fills. « @room » and a
  name typed in a client that fills none start nothing.

The gateway delivers at least once, in no set order: deduplicate on `id` where it matters.

## Credentials

The nodes use the **Twake Chat OAuth2 API** credential, which logs in through the Twake SSO. n8n
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

The trigger also needs the **Webhook Gateway URL** of the credential. It calls the gateway with an
access token it refreshes at the SSO, which must list the gateway in the audiences of the n8n client.

To end access, revoke the login at the SSO, then log out the `n8n` device in Twake Chat. The node
keeps using its Matrix token for up to an hour after the revocation, and the token stays valid at the
homeserver until that logout. Logging out the device alone only lasts until the next request, which
logs in again.

## Version history

### 0.1.0

The **Twake Chat API** credential, `twakeChatApi`, which took a pasted Matrix access token, is replaced
by the **Twake Chat OAuth2 API** credential, `twakeChatOAuth2Api`, which logs in through the Twake SSO.
A workflow that used the Twake Chat node needs a new **Twake Chat OAuth2 API** credential.
