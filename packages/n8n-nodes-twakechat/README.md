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

The node uses the **Twake Chat API** credential: the homeserver URL and a Matrix access token. It
does not use the Twake SSO login, as the homeserver refuses the SSO token.

To get an access token:

1. Open `https://<homeserver>/_matrix/client/v3/login/sso/redirect?redirectUrl=http://localhost`, sign
   in, and copy the `loginToken` from the URL you land on.
2. Trade it for an access token and copy the `access_token` of the answer into the credential:

   ```bash
   curl -X POST https://<homeserver>/_matrix/client/v3/login -H 'Content-Type: application/json' -d '{"type":"m.login.token","token":"<loginToken>"}'
   ```

The token acts as your whole Matrix account. To cut access, end that session from the Matrix client or
call `POST /_matrix/client/v3/logout` with the token.
