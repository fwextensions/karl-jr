# Chrome Web Store OAuth Setup

This guide walks through creating the Google OAuth credentials needed for the automated Chrome Web Store release workflow (`release-extension.yml`).  Complete these steps once.  After setup, the workflow uses three GitHub secrets — `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN` — to upload and publish the extension automatically on every version tag push.

---

## Prerequisites

- A Google account that is listed as a **developer** on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
- The extension must already exist in the Developer Dashboard (even as a draft).  You cannot automate publishing a brand-new extension that has never been manually uploaded.

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project selector at the top → **New Project**.
3. Name it something recognizable (e.g. `Karl Jr CWS`).
4. Click **Create** and wait for the project to be ready.

---

## Step 2 — Enable the Chrome Web Store API

1. In the left sidebar go to **APIs & Services → Library**.
2. Search for **Chrome Web Store API**.
3. Click the result and click **Enable**.

---

## Step 3 — Configure the OAuth consent screen

This step is required before you can create OAuth credentials.

1. Go to **APIs & Services → OAuth consent screen**.
2. For **User type**, select **External** and click **Create**.
3. Fill in the required fields:
   - **App name** — anything descriptive, e.g. `Karl Jr CWS Automation`
   - **User support email** — your Google account email
   - **Developer contact information** — your email again
4. Click **Save and Continue**.
5. On the **Scopes** screen, click **Save and Continue** (no scopes need to be added here; the Chrome Web Store API handles authorization separately).
6. On the **Test users** screen, click **Save and Continue**.
7. On the **Summary** screen, click **Back to Dashboard**.

### Publish the app (important — prevents token expiry)

By default the app is in **Testing** status, which causes refresh tokens to expire after 7 days.  To get a long-lived refresh token, publish the app:

1. On the OAuth consent screen dashboard, click **Publish App**.
2. Click **Confirm** in the dialog.

The status should now show **In production**.

> **Note:** Publishing this OAuth app does not make it publicly listed anywhere or require Google verification.  The Chrome Web Store API scopes are not in the restricted/sensitive category, so no verification review is triggered.

---

## Step 4 — Create OAuth client credentials

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. For **Application type**, select **Web application**.
4. Give it a name (e.g. `Karl Jr CWS CLI`).
5. Under **Authorized redirect URIs**, click **+ Add URI** and enter:
   ```
   http://localhost:1701
   ```
6. Click **Create**.
7. A dialog shows your credentials.  Copy both values and store them temporarily:
   - **Client ID** — will become `CWS_CLIENT_ID`
   - **Client secret** — will become `CWS_CLIENT_SECRET`

---

## Step 5 — Get the refresh token

The refresh token is obtained by running a one-time OAuth exchange using the [`chrome-webstore-upload-keys`](https://github.com/fregante/chrome-webstore-upload-keys) CLI tool.

### Install the tool

```bash
npx chrome-webstore-upload-keys
```

When prompted, enter the **Client ID** and **Client secret** from Step 4.

The tool will:
1. Print an authorization URL.
2. Open (or ask you to open) a browser window.
3. Prompt you to log in with the Google account that has access to the Chrome Web Store developer account.
4. Redirect to `http://localhost:1701` after you grant access.
5. Exchange the authorization code for tokens and print the **refresh token**.

Copy the refresh token — this becomes `CWS_REFRESH_TOKEN`.

> **Troubleshooting:** If you see `Error 400: redirect_uri_mismatch`, check that `http://localhost:1701` is listed under Authorized redirect URIs in Step 4, then retry.

---

## Step 6 — Add secrets to the GitHub repository

1. Go to your GitHub repository → **Settings → Secrets and variables → Actions**.
2. Add three repository secrets:

   | Secret name | Value |
   |---|---|
   | `CWS_CLIENT_ID` | Client ID from Step 4 |
   | `CWS_CLIENT_SECRET` | Client secret from Step 4 |
   | `CWS_REFRESH_TOKEN` | Refresh token from Step 5 |
   | `CWS_EXTENSION_ID` | The extension ID from the Chrome Web Store Developer Dashboard (32-character string visible in the extension URL) |

---

## Step 7 — Test the workflow

Push a version tag to trigger the release workflow:

```bash
# Make sure packages/extension/package.json version matches the tag
git tag v1.2.3
git push origin v1.2.3
```

The `release-extension.yml` workflow will:
1. Build the extension zip.
2. Create a GitHub Release with the zip attached.
3. Upload the zip to the Chrome Web Store and submit it for review.

Check the **Actions** tab on GitHub for the workflow run logs.

---

## Token maintenance

Refresh tokens obtained from a published OAuth app do not expire unless:

- You revoke them manually (via [myaccount.google.com/permissions](https://myaccount.google.com/permissions)).
- The Google account password is changed (sometimes invalidates tokens).
- The OAuth app is deleted from Google Cloud.
- The app has no activity for 6+ months (Google policy for inactive apps).

If a token is ever invalidated, repeat Step 5 only — the Client ID and Client Secret remain valid.  Update just the `CWS_REFRESH_TOKEN` secret in GitHub.

---

## Related files

- `.github/workflows/release-extension.yml` — the release workflow that uses these credentials
- `docs/chrome-web-store-submission.md` — store listing copy and privacy policy justifications
