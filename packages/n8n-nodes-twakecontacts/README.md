# n8n-nodes-twakecontacts

n8n community node to read the address books of a [Twake Workplace](https://twake.app/) user.

## Operations

- **Address Book > Get Many**: one item per address book of the connected user: personal, shared
  and subscribed. Fields are the raw answer of the service.

## Usage

Set up the credential and add the node. The address books of the connected user come out as one
item each.

Example workflow:

1. **Schedule Trigger**, once a week.
2. **Twake Contacts**, **Address Book > Get Many**.
3. Any node that stores `{{ $json["dav:name"] }}` and `{{ $json.numberOfContacts }}`.

## Credentials

The node uses the **Twake Contacts OAuth2 API** credential, which logs in through the Twake SSO. The
access token goes straight to the calendar side service, without exchange.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Its
   access token must be accepted by the calendar side service.
2. In the credential, fill in the Contacts API URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To cut access, revoke the login at the SSO.
