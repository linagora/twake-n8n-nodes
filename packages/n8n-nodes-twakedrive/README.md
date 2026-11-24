# @linagora/n8n-nodes-twakedrive

n8n community node to use [Twake Drive](https://twake.app/) in your workflows.

## Operations

Files, folders and shares are picked from a searchable list or by ID.

**File/Folder**

- Get: list the content of a folder, or get a file with its binary

**File**

- Upload, with an option to overwrite a file of the same name
- Create from text, as a `.txt` or as a note written in Markdown, with an option to overwrite
- Update, copy, move, rename, delete (to the trash)
- Get edit link: a link to edit an office document in OnlyOffice, in the Drive app of the logged-in
  user. It is not a public link, for that share by link. The output leaves out the `onlyoffice`
  block of the stack's answer, which holds the editor token.

**Folder**

- Create, move, rename, delete (to the trash)

**Share**

- Share a file or a folder by link, read-only or editable, with an optional expiry and password
- Delete a share

Results are the raw answers of the stack, in `$json.data`.

## Usage

Set up the credential, add the node, then pick a resource and an operation. The node runs once per
input item.

Example workflow: save the invoices received by another node.

1. Any node that outputs a binary, for example **HTTP Request** downloading a PDF.
2. **Twake Drive**, **File > Upload**, with the destination folder and **Overwrite** enabled.
3. **Twake Drive**, **Share > Create**, with the file set by ID to `{{ $json.data.id }}`, to get a
   link in the output.

## Trigger

The **Twake Drive Trigger** node starts a workflow when a file is added to your drive, by you or
through one of your sharing links (**File Created**).

**Watch** picks the files: **Any File**, or **Inside a Folder**, from the list or by ID. Only the
files directly in the folder start the workflow, unless **Watch Subfolders** is on: the node then
reads the path of the folder the file is in, and starts for a file at any depth.

It does not poll the instance. When the workflow is published, or listens for a test event, the node
subscribes its webhook URL at the Twake webhook gateway (ADR 075); when the workflow is unpublished,
it deletes the subscription. When n8n publishes the workflow again, a subscription for another URL or
for other events is replaced. Each call is signed, and the node refuses one whose signature is wrong
or older than five minutes.

The gateway sends ids only. With **Include File** on, the default, the node reads the file with your
token and outputs it as `file`, or `null` when you cannot see it anymore. Each item holds the event:
`id`, `type`, `time`, `twakeorg`, `twakeactorid` (your uuid, absent for a file added through a sharing
link) and `data.object` (the file's `id` and `folder.id`).

The instance publishes these events only when its context sets `drive_activity.file_created`, for
the files uploaded to a personal drive, and once it knows your uuid from a login or a token exchange.
The gateway delivers at least once, in no set order: deduplicate on `id` where it matters.

## Credentials

The node uses the **Twake Drive OAuth2 API** credential, which logs in through the Twake SSO. For each instance, n8n
exchanges the login for a stack token at `POST /auth/token_exchange`. The token has the permissions of
the n8n app manifest. That manifest is read-only for now, so operations that write are refused until
it allows them.

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

The trigger also needs the **Webhook Gateway URL** of the credential. It calls the gateway with an
access token it refreshes at the SSO, which must list the gateway in the audiences of the n8n client,
and the id_token must carry the `uuid` claim, which the stack keeps at the exchange.

To cut access for good, revoke the login at the SSO. Removing the client from **Twake Settings >
Connected devices** only lasts until the next exchange, within the hour, which creates a new one.

## Version history

### 0.1.0

First version of `@linagora/n8n-nodes-twakedrive`, from the [twake-n8n-nodes](../..) monorepo. It
follows `n8n-nodes-twakedrive` 1.6.0, from
[cozy/n8n-nodes-twakedrive](https://github.com/cozy/n8n-nodes-twakedrive), and what follows is
compared to that version.

Uninstall `n8n-nodes-twakedrive` before installing this package. Both declare a credential named
`twakeDriveOAuth2Api`, with different fields, and n8n only keeps one of the two.

- Fix uploads and updates when n8n stores binaries on the filesystem, the default mode: the stored ID
  was sent instead of the content
- Fix listing a folder picked in the dropdown, which always listed the root
- Fix share links on instances using nested subdomains
- Output an item with the `error` when `Continue On Fail` is enabled, instead of dropping it
- Add the **Input Binary Field** parameter on upload and update

Behavior changes:

- The credential now logs in through the Twake SSO and exchanges the login for a stack token, so
  existing credentials must be created again, see [Credentials](#credentials)
- Sharing without a target, or asking for a password without giving one, is now an error. It used to
  share the whole Drive, and to create a link without password.
- A downloaded file is always in the `data` binary field, and replaces a binary of the same name
- Update no longer downloads the file back, the output binary is the input one
- A folder listing is no longer capped at 2000 entries
- The output of the delete operations is `{ "deleted": true }`
- The operations are renamed, and files and folders are picked with a Resource Locator, so existing
  nodes must be set up again
