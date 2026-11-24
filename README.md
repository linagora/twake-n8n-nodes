# Twake n8n nodes

[n8n](https://n8n.io/) community nodes for the Twake Workplace apps.

| Package | Node | Features |
| --- | --- | --- |
| [`@linagora/n8n-nodes-twakedrive`](packages/n8n-nodes-twakedrive) | Twake Drive | Files, folders and share links |
| [`@linagora/n8n-nodes-twakeaccount`](packages/n8n-nodes-twakeaccount) | Twake Account | List apps, disk usage |
| [`@linagora/n8n-nodes-twakecalendar`](packages/n8n-nodes-twakecalendar) | Twake Calendar | List calendars |
| [`@linagora/n8n-nodes-twakemail`](packages/n8n-nodes-twakemail) | Twake Mail | Search and read emails, threads and attachments |
| [`@linagora/n8n-nodes-twakecontacts`](packages/n8n-nodes-twakecontacts) | Twake Contacts | List address books |
| [`@linagora/n8n-nodes-twakechat`](packages/n8n-nodes-twakechat) | Twake Chat | Current account |
| [`@linagora/n8n-nodes-twakeproject`](packages/n8n-nodes-twakeproject) | Twake Project | List projects |

## Development

Requires Node.js 24.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm test
```

Run a local n8n at http://localhost:5678 with the packages of this repo. It lives in the gitignored
`.n8n-dev` folder. Rebuild a package and n8n reloads it.

```bash
npm run n8n
```

In this mode the node types are prefixed with `CUSTOM.`, while they are prefixed with the package
name once installed from npm, such as `@linagora/n8n-nodes-twakedrive.twakeDriveNode`.
