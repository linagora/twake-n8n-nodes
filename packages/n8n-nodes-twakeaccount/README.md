# n8n-nodes-twakeaccount

n8n community node to read the apps and the disk usage of a [Twake Workplace](https://twake.app/)
instance.

## Operations

- **App > Get Many**: one item per app installed on the instance, with its `slug`, `name` and
  `state` under `attributes`.
- **Disk Usage > Get**: bytes `used` by the instance, split between `files` and `versions`, and the
  `quota` when there is one.

## Usage

Set up the credential and add the node. **App > Get Many** outputs one item per app, and **Disk
Usage > Get** one item per input item.

Example workflow: get alerted when the Drive is almost full.

1. **Schedule Trigger**, once a day.
2. **Twake Account**, **Disk Usage > Get**.
3. **If**, comparing `{{ $json.data.attributes.used }}` with `{{ $json.data.attributes.quota }}`.
4. Any node that sends a message.

## Credentials

The node uses the **Twake Account OAuth2 API** credential, which logs in through the Twake SSO. For
each instance, n8n exchanges the login for a stack token at `POST /auth/token_exchange`. The token has
the permissions of the n8n app manifest, so it covers more than the apps and the disk usage, including
reading files and contacts.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Id
   tokens must carry a `sid` claim.
2. In the stack configuration of the context, map this client to the n8n app:

   ```yaml
   authentication:
     my-context:
       oidc:
         issuer: https://sign-up.example.com
         id_token_jwk_url: https://sign-up.example.com/oauth2/jwks
         allow_app_token_exchange: true
         app_token_exchange:
           n8n:
             software_id: registry://n8n
             instance_claim: workplaceFqdn
   ```

   The [n8n app](https://github.com/linagora/n8n-app-wrapper) must be installed from the registry
   on the instance.
3. In the credential, fill in the SSO URL, the client ID and secret, and click **Connect**. The
   instance URL is optional: left empty, the node uses the instance the SSO gives in the
   `workplaceFqdn` claim of the id_token.

To cut access for good, revoke the login at the SSO. Removing the client from **Twake Settings >
Connected devices** only lasts until the next exchange, within the hour, which creates a new one.

## Version history

### 0.1.0

Replaces `n8n-nodes-twakehome` and `n8n-nodes-twakesettings`, which were never published. A workflow
that used the **Twake Home** or **Twake Settings** node needs the **Twake Account** node and a new
**Twake Account OAuth2 API** credential instead.
