# n8n-nodes-twaketasks

n8n community node to read the projects and manage the tasks of a
[Twake Workplace](https://twake.app/) user.

## Operations

- **Project > Get Many**: one item per project the connected user is a member of, with its `id`,
  `name` and `role`.

A task is found by its board, chosen in a list, and its ID, as in the output of **Task > Create**.
Sections, assignees and labels are chosen in lists read from the board. The operations that answer
nothing output `{ success: true, taskId }`.

- **Task > Create**: creates a task with a title, in a section or in none, or a subtask of a parent
  task. The other fields of **Update** can be set at once. Outputs the `id`, `key`, `title` and
  `sectionId` of the task.
- **Task > Update**: changes the title, priority, due date, due time and its time zone, deadline,
  duration, recurrence and description. **Clear Fields** empties the chosen fields. Dates keep only
  the day.
- **Task > Assign** and **Task > Set Labels**: replace the assignees or labels of a task. None
  removes them all.
- **Task > Move**: moves a task to a section of its board, last or next to another task.
- **Task > Complete**: completes, cancels or reopens a task. A task in a section moves to the first
  section of that kind, and the node fails if the board has none.
- **Task > Comment**: adds a comment in Markdown. Outputs its `id` and `createdAt`.
- **Task > Follow** and **Task > Unfollow**: the connected user gets, or stops getting, the
  notifications of a task.
- **Task > Archive** and **Task > Restore**: restore also brings back a deleted task.
- **Task > Transfer**: moves a task to a section of another board. Assignees who are not members of
  it are dropped. Outputs the new `key`, `droppedAssignees` and `createdLabels`.
- **Task > Add Reminder**: reminds the connected user at a date, or some minutes before the due date.
  Dates without a time zone are in the time zone of the workflow. Outputs the `id` of the reminder.
- **Task > Remove Reminder**: removes a reminder by that ID.

Errors of Twake Tasks show their code, such as `stale_neighbours`.

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
