# n8n-nodes-twakecalendar

n8n community node to read the calendars of a [Twake Workplace](https://twake.app/) user.

## Operations

- **Calendar > Get Many**: one item per calendar of the connected user: personal, delegated and
  subscribed. Fields are the raw answer of the service.

## Usage

Set up the credential and add the node. The calendars of the connected user come out as one item
each.

Example workflow: keep a list of calendars in a spreadsheet.

1. **Schedule Trigger**, once a week.
2. **Twake Calendar**, **Calendar > Get Many**.
3. **Google Sheets**, appending `{{ $json["dav:name"] }}`.

## Credentials

The node uses the **Twake Calendar OAuth2 API** credential, which logs in through the Twake SSO. The
access token goes straight to the calendar side service, without exchange.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Its
   access token must be accepted by the calendar side service.
2. In the credential, fill in the Calendar API URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To cut access, revoke the login at the SSO.
