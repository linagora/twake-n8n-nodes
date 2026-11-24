# @linagora/n8n-nodes-twakemail

n8n community node to read and send the emails of a [Twake Workplace](https://twake.app/) user.

## Operations

- **Email > Search**: emails, newest first, without their bodies. Filters: mailbox, sender, recipient,
  subject, text, dates, keywords such as `$seen`, and attachments. Several filters must all match.
- **Email > Get**: an email with its text and HTML bodies.
- **Email > Get Attachments**: the attachments of an email, and with **Download** their files as
  binaries `attachment_0`, `attachment_1`…
- **Email > Send**: an email in text or HTML, to recipients written `alice@example.com` or
  `Alice <alice@example.com>` and separated by commas. It goes to Sent.
- **Email > Create Draft**: the same email, saved in Drafts without sending it.
- **Email > Reply**: to the sender of an email, or with **Reply to All** also to its other recipients,
  in the same thread.
- **Email > Forward**: an email with its attachments, the original quoted below the message.
- **Email > Move**: an email to a mailbox, out of the mailboxes it was in.
- **Email > Mark as Read**, **Mark as Unread**, **Flag** and **Unflag**: an email.
- **Email > Delete**: an email, moved to Trash. The node never deletes for good.
- **Email > Answer Invitation**: accept, decline or maybe accept the invitation of an email. The
  server records the answer in the calendar and emails the organizer, in **Language** if set.
- **Label > Get Many**: the labels, with the keyword each one sets on emails. Search by **Has
  Keyword** finds the emails of a label.
- **Label > Create**: a label, with a color and a description.
- **Label > Apply**: a label to an email.
- **Team Mailbox > Get Many**: my team mailboxes, each with its members and their role, `member` or
  `manager`.
- **Team Mailbox > Add Member**: a user to a team mailbox, or a new role for a member. Only managers
  can.
- **Team Mailbox > Remove Member**: a user from a team mailbox. Only managers can.
- **Team Mailbox > Revoke Access**: leave a team mailbox.
- **Thread > Get**: the emails of a thread, from the `threadId` of any of them.
- **Session > Get**: the JMAP session of the connected user: account IDs, capabilities and API URLs.

## Usage

Set up the credential and add the node. Search and Thread > Get output one item per email, Label >
Get Many one item per label, Team Mailbox > Get Many one item per team mailbox, the other operations
one item per input item. Move, Mark, Flag, Delete and Label > Apply output the email as it is after
the change.

Example workflow:

1. **Manual Trigger**.
2. **Twake Mail**, **Session > Get**.
3. **Edit Fields**, keeping `{{ $json.username }}`.

## Credentials

The node uses the **Twake Mail OAuth2 API** credential, which logs in through the Twake SSO. The
access token goes straight to the JMAP server, without exchange.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Its
   access token must be accepted by the JMAP server.
2. In the credential, fill in the JMAP URL, the SSO URL, the client ID and secret, and click
   **Connect**.

To cut access, revoke the login at the SSO.
