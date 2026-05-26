# Ontario Payroll Solution

A modern, secure, and fully dynamic payroll system specifically compliant with Ontario employment standards. Designed to run seamlessly on the **Cloudflare Serverless Stack** (Workers & D1 Database) and integrated with **Google Authentication**.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bsproul/gitpaid)

---

## Technical Architecture

- **Frontend**: React (Vite, TailwindCSS, TypeScript)
- **Backend**: Hono Framework (Cloudflare Workers, TypeScript)
- **Database**: Cloudflare D1 (Serverless SQLite-compatible DB)
- **Authentication**: Google Sign-in / Identity Services (GIS) & Backend JWT Sessions
- **Ontario Compliance Calculations**:
  - Canadian Pension Plan (CPP) calculation with annual basic exemptions bounds and maximum caps.
  - Employment Insurance (EI) calculation with maximum caps.
  - Ontario Income Tax progressive brackets (federal & provincial).
  - Workplace Safety and Insurance Board (WSIB) insurable premiums.
  - Employer Health Tax (EHT) exemption threshold checking ($1,000,000 exemption limits).
  - YTD compliance statistics, pay stub PDF streams, and T4 XML serializations.

---

## Local Setup & Development

Follow these steps to run the application locally on your machine.

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher)

---

### Step 1: Run D1 Database Migrations
The backend uses Cloudflare D1 for data storage. Apply migrations locally to create the tables.

1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Apply migrations locally:
   ```bash
   npx wrangler d1 migrations apply payroll_db --local
   ```

*Note: For production, omit `--local` to apply them to your cloud database.*

---

### Step 2: Start the Backend (Cloudflare Worker Dev Server)
The backend runs on Hono and simulates a Cloudflare Worker locally using Wrangler.

1. In the `backend` folder, create `.dev.vars` to bind environment variables locally:
   ```bash
   echo "JWT_SECRET=local-jwt-development-secret-key-12345" > .dev.vars
   echo "GOOGLE_CLIENT_ID=123456789-placeholder.apps.googleusercontent.com" >> .dev.vars
   ```
2. Run the dev server:
   ```bash
   npm run dev
   ```
   The backend will start and listen on **`http://localhost:5001`**.

3. To run backend tests:
   ```bash
   npm test
   ```

---

### Step 3: Start the Frontend (Vite App)
The frontend connects to the backend locally.

1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite server:
   ```bash
   npm run dev
   ```
   The frontend will start and open on **`http://localhost:5173`**.

4. To run frontend tests:
   ```bash
   npm test
   ```

---

## Live Testing Bypass (No Google Setup Required)

For local development and testing, you do **not** need to register a GCP Google Client ID. A mock token bypass is built into the system.

1. Open the login screen (`http://localhost:5173`).
2. Under **"or live test bypass"**, enter a mock token.
3. Standard bypass tokens include:
   - `mock-google-token-admin`
   - `mock-google-token-testuser`
4. Click **"Bypass Auth for Live Testing"**.
5. This registers a mock user and automatically redirects to the stepped Company Settings Onboarding Wizard (if logging in for the first time) or directly into the Ontario Dashboard.

---

## Deploying to Cloudflare Production

### 1. Database Setup
Create the D1 database instance in your Cloudflare dashboard or via Wrangler:
```bash
npx wrangler d1 create payroll_db
```
Update your `backend/wrangler.toml` file with the generated `database_id`.

### 2. Apply Production Migrations
Apply the SQL DDL schema to your cloud instance:
```bash
npx wrangler d1 migrations apply payroll_db --remote
```

### 3. Set Production Secrets & Google Settings
To enable JWT authentication and send paystub emails using the Gmail API, you must configure the following secret variables in Cloudflare.

#### A. Google Developer Console Configuration:
1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API** under **APIs & Services**.
3. Configure the **OAuth Consent Screen** (internal or external), adding `https://www.googleapis.com/auth/gmail.send` as a scope, and add your test Gmail sender address as a test user.
4. Create an **OAuth Client ID** (Credential type: *Web Application* or *Desktop Application*) and copy the **Client ID** and **Client Secret**.

#### B. Generate Gmail Refresh Token:
Access tokens expire after 1 hour, so the backend uses a Refresh Token to generate access tokens programmatically:
1. Go to the [Google OAuth Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon in the top right, check **Use your own OAuth credentials**, and input your Google OAuth **Client ID** and **Client Secret**.
3. Select and authorize the `https://www.googleapis.com/auth/gmail.send` API scope using the sender Gmail account.
4. Click **Exchange authorization code for tokens** and copy the **Refresh Token**.

#### C. Set Wrangler secrets:
Run these commands from your local terminal to bind the secrets securely to your Cloudflare Worker:
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_ID
npx wrangler secret put GMAIL_CLIENT_SECRET
npx wrangler secret put GMAIL_REFRESH_TOKEN
```

### 4. Deploy the Backend Worker
Deploy Hono backend code to Cloudflare Workers:
```bash
cd backend
npx wrangler deploy
```

### 5. Deploy the Frontend
Build the production bundle of the frontend assets and publish them to Cloudflare Pages:
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Build the optimized static assets:
   ```bash
   npm run build
   ```
3. Deploy the `dist/` directory to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy dist
   ```
4. Define the frontend environment variable `VITE_API_URL` pointing to your deployed Hono backend URL (e.g. `https://payroll-backend.yourname.workers.dev/api`).

---

## Ontario Payroll Compliance Engine Details

The backend tax engine processes deductions dynamically:
- **CPP**: Employee & Employer matching (5.95% rate up to $68,500 with $3,500 basic exemption).
- **EI**: Employee (1.66% up to $63,200) and Employer matching (1.4x of employee deduction).
- **Income Tax**: Combines Federal and Provincial tax brackets to calculate cumulative progressive deductions.
- **WSIB**: Calculated as `Gross Earnings * WSIB Rate %`.
- **EHT**: 1.95% calculated on payroll, automatically applying the $1,000,000 threshold exemption if checked.
