# Google Console & OAuth Setup

To enable Google Authentication and send paystub emails using the Gmail API, you must configure your OAuth credentials on the Google Cloud Console.

---

## Step 1: Configure the OAuth Consent Screen

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project (e.g., "Gitpaid Payroll") and select it.
3.  In the left sidebar, navigate to **APIs & Services** > **OAuth Consent Screen**.
4.  Select a **User Type**:
    *   **Internal**: Best if your business uses Google Workspace. Only users in your organization can log in.
    *   **External**: Required if using @gmail.com accounts. The app remains in "Testing" mode.
5.  Click **Create** and fill out the required App Information (App Name, Support Email, Developer Email).
6.  **Scopes Step**:
    *   Click **Add or Remove Scopes**.
    *   Manually add the scope `https://www.googleapis.com/auth/gmail.send` (Gmail API send permission).
    *   Ensure standard profile/email scopes are also checked: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `openid`.
7.  **Test Users Step**:
    *   If your app is in "External / Testing" mode, you must explicitly add the email addresses of any users who will log in or connect their Gmail account as the company sender.
    *   Add your sender Gmail address to this list.

---

## Step 2: Create OAuth Credentials

1.  Navigate to **APIs & Services** > **Credentials**.
2.  Click **Create Credentials** at the top, and select **OAuth Client ID**.
3.  Select **Web Application** as the application type.
4.  Set the name (e.g., "Gitpaid Web Client").
5.  Under **Authorized JavaScript Origins**, add the following:
    *   `http://localhost:5173` (Local frontend Vite server)
    *   `http://localhost:5001` (Local backend Wrangler dev server)
    *   `https://your-worker.your-subdomain.workers.dev` (Your Cloudflare Workers production domain)
6.  Under **Authorized Redirect URIs**, add:
    *   `http://localhost:5001/api/auth/google/callback` (Local backend callback handler)
    *   `https://your-worker.your-subdomain.workers.dev/api/auth/google/callback` (Production backend callback handler)
7.  Click **Create**.
8.  A modal will appear containing your **Client ID** and **Client Secret**. Copy these values.

---

## Step 3: Enable the Gmail API

1.  In the Google Cloud Console, navigate to the **Library** search bar (under APIs & Services).
2.  Search for **Gmail API**.
3.  Click on the **Gmail API** result and click **Enable**.
    *   *If the API is not enabled, the backend will receive errors when attempting to send pay stub emails.*

---

## Step 4: Configure Local Credentials

Once you have your credentials, save them in your local configuration:

1.  Open `backend/.dev.vars`.
2.  Replace the placeholder values with your real Google credentials:
    ```env
    GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
    GMAIL_CLIENT_SECRET="your-google-client-secret"
    ```
3.  Restart your local backend dev server.
