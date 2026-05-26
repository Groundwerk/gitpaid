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

1. Install root dependencies and run local migrations:
   ```bash
   npm install
   npm run db:migrate:local
   ```
   *(This automatically navigates to the backend folder and executes `npx wrangler d1 migrations apply DB --local` on the local database.)*

---

### Step 2: Start the Backend (Hono Dev Server)
The backend runs on Hono and simulates a Cloudflare Worker locally using Wrangler.

1. In the `backend` folder, copy the local environment variables template:
   ```bash
   cp backend/.dev.vars.example backend/.dev.vars
   ```
2. Start the backend development server from the repository root:
   ```bash
   npm run dev:backend
   ```
   The backend will start and listen on **`http://localhost:5001`**.

3. To run backend tests:
   ```bash
   npm --prefix backend test
   ```

---

### Step 3: Start the Frontend (Vite App)
The frontend connects to the backend locally.

1. Start the Vite dev server from the repository root:
   ```bash
   npm run dev:frontend
   ```
   The frontend will start and open on **`http://localhost:5173`**.

2. To run frontend tests:
   ```bash
   npm --prefix frontend test
   ```

---

## Live Testing Bypass (No Google Setup Required)

For local development and testing, you do **not** need to register a Google Client ID. A mock token bypass is built into the system.

1. Open the login screen (`http://localhost:5173`).
2. Under **"or live test bypass"**, enter a mock token.
3. Standard bypass tokens include:
   - `mock-google-token-admin`
   - `mock-google-token-testuser`
4. Click **"Bypass Auth for Live Testing"**.
5. This registers a mock user and automatically redirects to the stepped Company Settings Onboarding Wizard (if logging in for the first time) or directly into the Ontario Dashboard.

---

## Google Developer Console Configuration (Prerequisites)

To enable Google Authentication and send paystub emails using the Gmail API, you must configure your OAuth client on the Google Cloud Console.

### 1. Configure the OAuth Consent Screen
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and navigate to **APIs & Services** > **OAuth Consent Screen**.
3. Select User Type (**Internal** for organizations, **External** for testing).
4. Add the scope `https://www.googleapis.com/auth/gmail.send`.
5. Add your sender Gmail address under **Test users**.

### 2. Create OAuth Credentials
1. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth Client ID**.
2. Select **Web Application** as the application type.
3. Register the Authorized Origins:
   * **Authorized JavaScript origins**:
     * `http://localhost:5173` (Local frontend dev)
     * `http://localhost:5001` (Local backend dev)
     * `https://your-worker-name.your-subdomain.workers.dev` (Production backend/frontend URL)
   * **Authorized redirect URIs**:
     * `http://localhost:5001/api/auth/google/callback` (Local authentication callback)
     * `https://your-worker-name.your-subdomain.workers.dev/api/auth/google/callback` (Production callback)
4. Copy the generated **Client ID** and **Client Secret**.

---

## Deploying to Cloudflare Production

You can deploy the full-stack monorepo to Cloudflare using the automated deploy button, or manually from your CLI.

### Option 1: Using the "Deploy to Cloudflare" Button (Automatic)
The button handles the provisioning and connection of resources automatically:

1. Click the **Deploy to Cloudflare Workers** button at the top of the README.
2. The wizard will prompt you to authorize GitHub and will clone the repository under a new name (e.g. `payroll-backend`) in your GitHub account.
3. The wizard will automatically provision a new D1 database instance and bind it as `DB` to your Worker.
4. The wizard will detect `.dev.vars.example` and securely prompt you to input the required secrets:
   * `JWT_SECRET` (A random string for session tokens)
   * `GOOGLE_CLIENT_ID` (Your Google Client ID)
   * `GMAIL_CLIENT_SECRET` (Your Google Client Secret)
5. Cloudflare will build the Vite frontend, bundle it with the Hono worker, automatically apply the D1 database migrations remote-side, and publish the worker.
6. **Subsequent Deploys**: Any future commits pushed to the newly created GitHub repository will automatically trigger a build, apply migrations, and redeploy.

---

### Option 2: Manual Deployment from CLI
To deploy directly from your local terminal without hardcoding credentials in Git:

1. **Add config file to `.gitignore`**:
   Add `wrangler.production.toml` to your `.gitignore` so your production IDs are never committed.

2. **Create the production D1 Database**:
   Create the D1 database instance using Wrangler:
   ```bash
   npx wrangler d1 create payroll_db
   ```
   Copy the generated `database_id` from the terminal output.

3. **Create `wrangler.production.toml` at the root**:
   Duplicate the root `wrangler.toml` file, name the copy `wrangler.production.toml`, and replace the `database_id` placeholder with your actual production D1 database ID:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "payroll_db"
   database_id = "your-actual-database-id-here"
   migrations_dir = "backend/migrations"
   ```

4. **Deploy and run migrations**:
   Compile the frontend assets, apply migrations remote-side, and deploy the worker using the production configuration:
   ```bash
   npm run build
   npx wrangler d1 migrations apply DB --remote --config wrangler.production.toml
   npx wrangler deploy --config wrangler.production.toml
   ```

5. **Configure Production Secrets**:
   Upload your secrets securely to your Cloudflare Worker:
   ```bash
   npx wrangler secret put JWT_SECRET --config wrangler.production.toml
   npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.production.toml
   npx wrangler secret put GMAIL_CLIENT_SECRET --config wrangler.production.toml
   ```

---

## Ontario Payroll Compliance Engine Details

The backend tax engine processes deductions dynamically:
- **CPP**: Employee & Employer matching (5.95% rate up to $68,500 with $3,500 basic exemption).
- **EI**: Employee (1.66% up to $63,200) and Employer matching (1.4x of employee deduction).
- **Income Tax**: Combines Federal and Provincial tax brackets to calculate cumulative progressive deductions.
- **WSIB**: Calculated as `Gross Earnings * WSIB Rate %`.
- **EHT**: 1.95% calculated on payroll, automatically applying the $1,000,000 threshold exemption if checked.
