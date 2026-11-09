# Twake n8n nodes

[n8n](https://n8n.io/) community nodes for the Twake Workplace apps.

| Package | Node | Features |
| --- | --- | --- |
| [`n8n-nodes-twakedrive`](packages/n8n-nodes-twakedrive) | Twake Drive | Files, folders and share links |

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
name once installed from npm.
