# Azure AD App Registration — Teams Integration Setup

This guide walks you through registering an Azure AD application so MeetingMetric can authenticate users with Microsoft and access their Teams meetings and transcripts.

## Prerequisites

- An Azure account with permission to create app registrations (usually a Microsoft 365 tenant)
- Your MeetingMetric server URL (e.g. `https://api.yourdomain.com` or `http://localhost:3001` for local dev)

## Step 1: Create an Azure AD app registration

1. Go to the [Azure Portal](https://portal.azure.com) and sign in.
2. Navigate to **Azure Active Directory** → **App registrations** → **New registration**.
3. Fill in the form:
   - **Name**: `MeetingMetric` (or any name you prefer)
   - **Supported account types**: _Accounts in any organizational directory and personal Microsoft accounts_
   - **Redirect URI**: Select **Web** and enter your callback URL:
     - Local dev: `http://localhost:3001/api/teams/callback`
     - Production: `https://api.yourdomain.com/api/teams/callback`
4. Click **Register**.

## Step 2: Note the Application (Client) ID

After registration you'll land on the app overview page. Copy the **Application (client) ID** — this is your `AZURE_CLIENT_ID`.

## Step 3: Create a client secret

1. In the left menu click **Certificates & secrets** → **New client secret**.
2. Add a description (e.g. `meetingmetric-server`) and choose an expiry.
3. Click **Add**.
4. Copy the **Value** immediately — it won't be shown again. This is your `AZURE_CLIENT_SECRET`.

## Step 4: Configure API permissions

1. In the left menu click **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add all of the following permissions:

| Permission | Purpose |
|---|---|
| `User.Read` | Read the signed-in user's profile |
| `OnlineMeetings.Read` | List online meetings |
| `OnlineMeetings.ReadAll` | (Optional) Read meetings of all users if tenant admin |
| `Calendars.Read` | Read the user's calendar events |
| `OnlineMeetingTranscript.Read.All` | Download meeting transcript files |

3. Click **Grant admin consent** if you have the required admin role (needed for `*.ReadAll` permissions).

## Step 5: Set the environment variables

Add these to `server/.env`:

```env
AZURE_CLIENT_ID=<your-application-client-id>
AZURE_CLIENT_SECRET=<your-client-secret-value>
AZURE_REDIRECT_URI=http://localhost:3001/api/teams/callback
# For production use your public URL
# AZURE_REDIRECT_URI=https://api.yourdomain.com/api/teams/callback
```

Optional — restrict to a specific tenant (leave empty for multi-tenant):

```env
AZURE_TENANT_ID=<your-tenant-id>
```

## Step 6: Verify the integration

1. Restart the server: `npm start` (from the `server/` directory).
2. Log in to MeetingMetric.
3. Go to **Settings** → **Microsoft Teams**.
4. Click **Connect Microsoft Teams** — you should be redirected to the Microsoft sign-in page.
5. After authorizing, you'll be redirected back to MeetingMetric with a success message.

## Auto-ingestion

Once connected, MeetingMetric polls for new Teams meetings every 5 minutes. You can also trigger a manual sync from:

- **Settings** → **Microsoft Teams** → **Sync Now**
- **Analyze** page → Teams status card → **Sync Now**

The poll service ingests new meetings, downloads VTT transcripts, runs the AI analysis pipeline, and inserts results into the database automatically.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Teams integration requires Azure AD configuration" | `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` missing from `.env` |
| "Teams connection failed: AADSTS..." | Check the redirect URI matches exactly what's registered in Azure |
| Transcripts not downloading | Ensure `OnlineMeetingTranscript.Read.All` permission is granted |
| 403 on Graph API calls | Token may have expired — click **Connect Microsoft Teams** again to re-authorize |
| Auto-ingestion not running | Check server logs for `pollService` errors; confirm Teams token is still valid |

## Token refresh

MeetingMetric attempts a silent token refresh before each poll. If the refresh token has expired (typically after 90 days of inactivity), the user will need to re-authorize via **Settings** → **Microsoft Teams** → **Connect Microsoft Teams**.
