# Local Development Setup

Follow this guide to run the Gitpaid application locally on your development machine.

---

## Prerequisites

Before starting, ensure you have the following installed:
*   **Node.js**: version 18.0.0 or higher
*   **npm**: version 9.0.0 or higher

---

## Step 1: Run D1 Database Migrations

The Hono backend uses a local SQLite database that simulates a Cloudflare D1 database.

1.  Clone your repository fork and navigate to the root directory.
2.  Install dependencies and apply migrations:
    ```bash
    npm install
    npm run db:migrate:local
    ```
    *This runs the backend migrations and creates the local database file `backend/payroll.db`.*

---

## Step 2: Start the Backend (Hono)

The backend runs on Hono and simulates a Cloudflare Worker locally using Wrangler.

1.  In the `backend/` folder, copy the local configuration variables template:
    ```bash
    cp backend/.dev.vars.example backend/.dev.vars
    ```
2.  Open `backend/.dev.vars` and verify it contains default values for local development:
    ```env
    GOOGLE_CLIENT_ID="805189420900-fjlco7a7p1t4516tdiq3d6nshtokidbf.apps.googleusercontent.com"
    GMAIL_CLIENT_SECRET="your-google-client-secret"
    JWT_SECRET="local-jwt-development-secret-key-12345"
    ALLOW_MOCK_LOGIN="true"
    ```
3.  Start the backend development server from the repository root:
    ```bash
    npm run dev:backend
    ```
    *The backend server will start and listen on **`http://localhost:5001`**.*

4.  To run backend unit and integration tests:
    ```bash
    npm --prefix backend test
    ```

---

## Step 3: Start the Frontend (Vite)

The React frontend connects to the local backend Hono API.

1.  In the `frontend/` folder, copy the local environment variables template:
    ```bash
    cp frontend/.env.example frontend/.env
    ```
2.  Verify the contents of `frontend/.env`:
    ```env
    VITE_ALLOW_BYPASS="true"
    ```
3.  Start the frontend Vite dev server from the repository root:
    ```bash
    npm run dev:frontend
    ```
    *The frontend will start and open in your browser at **`http://localhost:5173`**.*

4.  To run frontend tests:
    ```bash
    npm --prefix frontend test
    ```

---

## Live Testing Bypass

For local development, you do **not** need a valid Google Client ID or Google project. A mock token bypass is built into the system.

### How it is configured:
1.  **Frontend Gate**: `VITE_ALLOW_BYPASS="true"` inside `frontend/.env` enables the bypass form on the login view.
2.  **Backend Gate**: `ALLOW_MOCK_LOGIN="true"` inside `backend/.dev.vars` permits the API route to accept mock signatures.

If **both** gates are enabled, the login screen displays the **"or live test bypass"** form:
*   Standard bypass tokens include `mock-google-token-admin` or `mock-google-token-testuser`.
*   Clicking **"Bypass Auth for Live Testing"** bypasses the Google login, logs in a mock user, and directs you to onboarding or the dashboard.

### Production Safety:
*   In production, `ALLOW_MOCK_LOGIN` is **never** set to `"true"`.
*   The backend API strictly rejects any request containing mock tokens with a `401 Unauthorized` response unless `ALLOW_MOCK_LOGIN` is `"true"`.
*   The login bypass UI is completely hidden from the production build.
