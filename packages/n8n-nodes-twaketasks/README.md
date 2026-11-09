# n8n-nodes-twaketasks

n8n community node to read the projects of a [Twake Workplace](https://twake.app/) user.

## Operations

- **Project > Get Many**: one item per project the connected user is a member of, with its `id`,
  `name` and `role`.

## Usage

Set up the credential and add the node. The projects of the connected user come out as one item
each.

Example workflow:

1. **Schedule Trigger**, once a week.
2. **Twake Tasks**, **Project > Get Many**.
3. Any node that stores `{{ $json.name }}`.

## Credentials

The node uses the **Twake Tasks OAuth2 API** credential, which logs in through the Twake SSO. The
access token goes straight to Twake Tasks, without exchange.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Its
   access token must be accepted by Twake Tasks.
2. In the credential, fill in the Tasks URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To cut access, revoke the login at the SSO.
