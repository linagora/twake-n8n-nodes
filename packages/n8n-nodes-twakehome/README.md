# n8n-nodes-twakehome

n8n community node to read the apps of a [Twake Workplace](https://twake.app/) instance.

## Operations

- **App > Get Many**: one item per app installed on the instance, with its `slug`, `name` and
  `state` under `attributes`.

## Usage

Set up the credential and add the node. The apps of the instance come out as one item each.

Example workflow:

1. **Schedule Trigger**, once a week.
2. **Twake Home**, **App > Get Many**.
3. Any node that stores `{{ $json.attributes.slug }}`.

## Credentials

The node uses the **Twake Home OAuth2 API** credential, which logs in through the Twake SSO. For each
instance, n8n exchanges the login for a stack token at `POST /auth/token_exchange`. The token has the
permissions of the n8n app manifest, so it covers more than the installed apps, including reading
files and contacts.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Id
   tokens must carry a `sid` claim.
2. Map this client to the n8n app in the stack configuration of the context, with
   `allow_app_token_exchange: true` and an `app_token_exchange` entry for `registry://n8n`. The
   [Twake Settings README](../n8n-nodes-twakesettings/README.md#credentials) has the full example.
   The [n8n app](https://github.com/linagora/n8n-app-wrapper) must be installed from the registry on
   the instance.
3. In the credential, fill in your instance URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To cut access for good, revoke the login at the SSO.
