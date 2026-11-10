# n8n-nodes-twakedrive

n8n community node to use [Twake Drive](https://twake.app/) in your workflows.

## Operations

Files, folders and shares are picked from a searchable list or by ID.

**File/Folder**

- Get: list the content of a folder, or get a file with its binary

**File**

- Upload, with an option to overwrite a file of the same name
- Create from text, as a `.txt` or as a note written in Markdown, with an option to overwrite
- Update, copy, move, rename, delete (to the trash)

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

To cut access for good, revoke the login at the SSO. Removing the client from **Twake Settings >
Connected devices** only lasts until the next exchange, within the hour, which creates a new one.

## Version history

### 1.7.0

Moved to the [twake-n8n-nodes](../..) monorepo. Previous versions come from
[cozy/n8n-nodes-twakedrive](https://github.com/cozy/n8n-nodes-twakedrive).

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
