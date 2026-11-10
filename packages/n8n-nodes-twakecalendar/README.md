# n8n-nodes-twakecalendar

n8n community node to manage the calendars and events of a [Twake Workplace](https://twake.app/)
user.

## Operations

- **Calendar > Get Many**: one item per calendar of the connected user: personal, delegated and
  subscribed. Fields are the raw answer of the service.
- **Event > Create**: creates an event in a calendar, with its title, start and end, and optionally
  a description, a location, attendees, rooms and alarms. With attendees or rooms, the user becomes
  the organizer and the calendar service sends the invitations. Outputs the `uid` of the event and
  the event as stored, in jCal.
- **Event > Update**: changes the fields that are set. Attendees, rooms and alarms replace the
  previous ones, and an attendee still invited keeps their answer. For a recurring event, the main
  event changes and its exceptions stay as they are. Outputs like Create.
- **Event > Delete**: deletes an event, which cancels it for its attendees.

An event is found by its calendar and its `uid`. Dates without a time zone are in the time zone of
the workflow. Rooms and equipment are booked by their email.

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
