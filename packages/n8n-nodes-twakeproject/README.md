# @linagora/n8n-nodes-twakeproject

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

These three read the tasks of the connected user on every board, one item per task, with the board
task fields plus `boardId`, `boardName`, `projectId`, `category` and `parentTitle`. Days are counted
in the time zone of the workflow, and the whole list comes out at once.

- **Task > Get My Tasks**: the open tasks assigned to the user.
- **Task > Get Agenda**: the open tasks due in the next **Days** (7 by default, 60 at most), late ones
  included, assigned to the user or, outside managed projects, to nobody.
- **Task > Get Filtered**: the tasks matching a saved filter of the user, chosen in a list.

Errors of Twake Project show their code, such as `stale_neighbours`.

## Trigger

The **Twake Project Trigger** node starts a workflow on these events:

- **Task Created** and **Task Deleted** (moved to the trash), with **Created By** and **Deleted By**
  set to **Me**: Twake Project only tells you about the tasks you create or delete.
- **Task Assigned** and **Task Unassigned**: someone is assigned to a task, or removed from it.
  Twake Project only tells you when you assign or remove someone, and when someone assigns you.

**Assigned To** narrows both assignment events to the person assigned or removed:

- **Me**, the default: someone assigns you, or you assign or remove yourself.
- **Anyone**: whoever you assign or remove, and you when someone assigns you.
- **Specific People**: a list of emails, matched against the members of the task's project, so a
  person who left it is not recognised.

It does not poll Twake Project. When the workflow is published, or listens for a test event, the node
subscribes its webhook URL at the Twake webhook gateway (ADR 075); when the workflow is unpublished,
it deletes the subscription. When n8n publishes the workflow again, a subscription for another URL,
such as after n8n moved, or for other events is replaced. Each call is signed, and the node refuses
one whose signature is wrong or older than five minutes.

The gateway sends ids only. With **Include Task** on, the default, the node reads the task from its
board with your token and outputs it as `task`, or `null` when you cannot see it anymore. Each item
holds the event: `id`, `type`, `time`, `twakeorg`, `twakeactorid` (the uuid of who made the change),
`data.object` (the task's `id` and `board.id`), `data.container` (its project) and, for an
assignment, `data.assignee.id` (the uuid of the person assigned or removed).

The gateway delivers at least once, in no set order: deduplicate on `id` where it matters. An n8n
unreachable for more than 24 hours loses the events of that time.

## Usage

Set up the credential and add the node. The projects of the connected user come out as one item
each.

Example workflow:

1. **Schedule Trigger**, once a week.
2. **Twake Project**, **Project > Get Many**.
3. Any node that stores `{{ $json.name }}`.

## Credentials

The node uses the **Twake Project OAuth2 API** credential, which logs in through the Twake SSO. The
access token goes straight to Twake Project, without exchange.

1. In the SSO, register a confidential OIDC client for n8n, for example `n8n`, with the
   `openid profile email offline_access` scopes and the **OAuth Redirect URL** of the credential. Its
   access token must be accepted by Twake Project.
2. In the credential, fill in the Tasks URL, the SSO URL, the client ID and secret, and click
   **Connect**.

The trigger also needs the **Webhook Gateway URL** of the credential, and an access token that the
gateway accepts: the SSO adds the gateway to the audiences of the n8n client, and the gateway
allows the webhook URLs of this n8n.

To cut access, revoke the login at the SSO.
