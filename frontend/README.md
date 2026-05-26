# Ontario Payroll Solution - Frontend

A modern, responsive React single-page application (SPA) built with Vite, TypeScript, and TailwindCSS. It integrates with a secure Hono/Cloudflare Worker backend to perform payroll onboarding, calculations, directory management, compliance logging, and email distribution.

## Technical Stack
- **Framework**: React (functional components, hooks)
- **Build Tool**: Vite
- **Language**: TypeScript
- **Styling**: TailwindCSS & Vanilla CSS (with Material Symbols icons)
- **State Management**: React state hooks (`useState`, `useEffect`) and local storage session persistence
- **Testing**: Vitest & React Testing Library

---

## Core Views & Layouts

The frontend features a fluid, responsive sidebar navigation dashboard containing the following views:

1. **Dashboard (`DashboardView.tsx`)**:
   - Displays real-time KPIs (Active Employees, Gross Pay YTD, CRA Liabilities Due).
   - Shows urgent yellow `DUE SOON` and red `OVERDUE` compliance notification banners.
   - Lists the rolling upcoming pay cycles across all pay groups with quick-action links to start runs.

2. **Employee Directory (`EmployeeDirectoryView.tsx`)**:
   - Lists all employees with profile avatars, salary details, payment methods, active/archive statuses, and assigned pay groups.
   - Row-level context menus for quick actions (edit profile, download PDF paystubs, email stubs, reverse payments).
   - Toggle filters to hide or display archived employees.

3. **Stepped Onboarding Wizard (`OnboardingView.tsx`)**:
   - A 4-step wizard for new companies registering in the app:
     1. **Company Profile**: Legal/Operating names and CRA Business Number (BN15) validation.
     2. **Contact Info**: Admin details and primary email address.
     3. **Payroll & Tax**: Default intervals, WSIB account registration, EHT exemption checkboxes.
     4. **Email Stubs**: Direct Google OAuth linkage to connect Gmail as the company's sender account.

4. **Payrun Wizard (`PayrollRunView.tsx`)**:
   - An interactive wizard for running payroll:
     * **Step 1**: Choose an upcoming schedule period (locks dates and filters members) or run an ad-hoc cycle.
     * **Step 2**: Edit hour inputs, commission, or vacation payout overrides for draft rows. Runs live backend tax calculations in real-time.
     * **Step 3**: Review run totals, net payouts, WSIB premiums, and CRA deductions, then finalize the run.

5. **Compliance & Reports (`ReportsView.tsx`)**:
   - **Compliance Ledger**: Aggregated cards for CRA, WSIB, and EHT premiums separating outstanding active liabilities from upcoming ones.
   - **Remittance Payments panel**: Log checks, e-Transfers, or cash payments to CRA, WSIB, or EHT. Deleting log records dynamically restores the liabilities.
   - **MIME Email Paystubs**: Batch-select check boxes and a dark floating action bar to trigger base64url-encoded RFC 2822 emails to multiple employees concurrently.
   - **Exporters**: Downloads JWT-authorized PDF paystubs and T4 XML serializations via async Blob downloads.

---

## Configuration & Connection

The frontend communicates with the Hono backend API.

- **API Base URL**: Configured in [api.ts](file:///Users/brandon/payroll/frontend/src/utils/api.ts). It defaults to `http://localhost:5001/api` locally, but reads `import.meta.env.VITE_API_URL` at build time.
- **Session Authentication**: Retrieves the signed JWT session token from local storage and attaches it as a `Bearer` token inside the `Authorization` header on all request intercepts.
- **Dynamic OAuth Client ID**: Fetches the public Google OAuth client ID dynamically from the backend on load at `/api/auth/config`, bypassing the need to supply the client ID during static asset compilation.

---

## Local Setup & Commands

Run these commands inside the `frontend/` directory:

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Start Vite development server**:
   ```bash
   npm run dev
   ```
   *(Opens locally on `http://localhost:5173`)*
3. **Execute Unit Tests**:
   ```bash
   npm run test
   ```
4. **Compile production build**:
   ```bash
   npm run build
   ```
