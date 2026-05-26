# Ontario Payroll Solution - Backend Worker

A secure, serverless Hono.js REST API running on Cloudflare Workers and backed by a Cloudflare D1 SQL database. It computes progressive Canadian/Ontario payroll taxes, manages D1 state transactions, and handles Google OAuth authentication and paystub distribution via the Gmail API.

## Technical Stack
- **Framework**: Hono.js (running on Node compatibility mode)
- **Database**: Cloudflare D1 (SQLite engine)
- **Authentication**: Google Tokeninfo verification & JWT Session Tokens
- **Testing**: Vitest & Hono integration test utilities

---

## Architecture & Routers

The backend router mounts routes at `/api` and is structured as follows:

1. **Authentication (`routes/auth.ts`)**:
   - `GET /api/auth/config`: Exposes `GOOGLE_CLIENT_ID` dynamically to the client at runtime.
   - `POST /api/auth/google`: Verifies Google ID tokens (supporting mock token bypasses for local testing) and generates signed JWT sessions.
   - `GET /api/auth/google/login-url`: Signs state tokens and compiles the Google OAuth consent URL for Gmail scopes.
   - `GET /api/auth/google/callback`: Exchanges auth codes, encrypts Google refresh tokens using Web Crypto AES-GCM standards, and links them to the company profile.

2. **Employees (`routes/employees.ts`)**:
   - Manages employee profiles, pay frequencies, hourly/salary parameters, custom WSIB categories, and mid-year YTD transfer locks.

3. **Payroll Runs (`routes/payroll.ts`)**:
   - Orchestrates draft payroll calculations, edit updates, D1 transactional commits, run finalizations (which advance pay group schedules), and active-period locked reversals (which rollback YTD stats).

4. **Schedules (`routes/schedules.ts`)**:
   - Manages timezone-safe UTC rolling pay schedules (Weekly, Bi-weekly, Semi-monthly, Monthly) modeled after Sage Payroll.

5. **Compliance & Reports (`routes/reports.ts`)**:
   - Exposes cumulative YTD summaries, CRA/WSIB/EHT outstanding active/upcoming liabilities, D1 remittance payments logging, JWT-authorized paystub PDF streams, and T4 XML serializations.
   - Dispatches MIME-encoded raw RFC 2822 emails to employees via Google Gmail REST API endpoints with a 1-second throttle.

---

## The Ontario Payroll Compliance Engine

All calculations are executed inside [taxEngine.ts](file:///Users/brandon/payroll/backend/src/services/taxEngine.ts):
- **CPP Deductions**: Calculates employee and employer matching contributions (5.95% rate up to $68,500 maximum insurable earnings with a timezone-safe basic exemption allocation).
- **EI Deductions**: Calculates employee (1.66% rate up to $63,200 maximum) and employer contributions (matched at 1.4x the employee rate).
- **Progressive Income Tax**: Dynamically projects gross earnings to annual figures, applies federal and provincial brackets to compute progressive taxes, offsets the basic personal amounts, and translates them back to pay-period deductions.
- **WSIB Premiums**: Assesses employer workplace safety premiums based on custom employee categorization rates.
- **EHT Liabilities**: Assesses Employer Health Tax premiums (1.95% rate) while automatically applying the $1,000,000 exemption limit.

---

## Configuration & Local Setup

### Environment Variables & Secrets
The Worker expects the following variables inside `.dev.vars` (local dev) or bound as Cloudflare Secrets (production):
- `JWT_SECRET` (A secure random string for JWT signatures and AES encryption keys)
- `GOOGLE_CLIENT_ID` (GCP Client ID)
- `GMAIL_CLIENT_SECRET` (GCP Client Secret)

### Commands
Run these commands inside the `backend/` directory:

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Apply D1 migrations locally**:
   ```bash
   npx wrangler d1 migrations apply DB --local
   ```
3. **Start local wrangler dev server**:
   ```bash
   npm run dev
   ```
   *(Backend runs on `http://localhost:5001`)*
4. **Execute integration tests**:
   ```bash
   npm run test
   ```
