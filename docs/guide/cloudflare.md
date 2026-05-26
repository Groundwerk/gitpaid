# Cloudflare Workers & D1 Deployment

Gitpaid is designed to run completely serverless on Cloudflare Workers and D1 Databases. You can deploy it using the automated deployment button or manually from your terminal.

---

## Option 1: Automated "Deploy to Cloudflare" Button (Recommended)

Cloudflare provides a deployment button that automates the setup, database creation, and builds.

1.  Click the **Deploy to Cloudflare Workers** button at the top of the project [README.md](../README.md).
2.  **Authorize GitHub**: The wizard will request permission to fork the Gitpaid repository into your GitHub account.
3.  **Provision Database**: The wizard automatically provisions a new Cloudflare D1 Database and binds it to your Worker as `DB`.
4.  **Configure Secrets**: The wizard reads the root [.dev.vars.example](../.dev.vars.example) and prompts you to fill in the required environment variables:
    *   `JWT_SECRET`: A secure random string used to sign user sessions and encrypt Google credentials at rest.
    *   `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID (obtained from the Google Cloud Console).
    *   `GMAIL_CLIENT_SECRET`: Your Google OAuth Client Secret (obtained from the Google Cloud Console).
5.  **Build and Deploy**: Cloudflare will install dependencies, build the React frontend, bundle the backend Hono API, run the D1 database migrations, and deploy the application.
6.  **Subsequent Changes**: Any updates pushed to your newly created GitHub repository will automatically trigger Cloudflare to rebuild and redeploy the Worker.

---

## Option 2: Manual CLI Deployment

If you prefer to deploy directly from your local CLI, follow these steps:

### 1. Ignore Configuration Overrides
Ensure `wrangler.production.toml` is added to your `.gitignore` file so your database IDs are never checked into Git.

### 2. Create the Production D1 Database
Run the following wrangler command to create your production database:
```bash
npx wrangler d1 create payroll_db
```
Copy the generated `database_id` from the console output.

### 3. Create `wrangler.production.toml` at the Root
Duplicate `wrangler.toml` at the root directory, name it `wrangler.production.toml`, and update the `database_id` with your database ID:
```toml
[[d1_databases]]
binding = "DB"
database_name = "payroll_db"
database_id = "your-actual-database-id-copied-above"
migrations_dir = "backend/migrations"
```

### 4. Build and Apply Migrations
Run the build script to compile the frontend, copy it to the backend public assets folder, and apply migrations on the remote database:
```bash
npm run build
npx wrangler d1 migrations apply DB --remote --config wrangler.production.toml
```

### 5. Deploy the Worker
Publish the Worker and its assets:
```bash
npx wrangler deploy --config wrangler.production.toml
```

### 6. Upload Encrypted Secrets
Do **not** place secrets in your `wrangler.production.toml`. Upload them securely using the Wrangler secret CLI:
```bash
npx wrangler secret put JWT_SECRET --config wrangler.production.toml
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.production.toml
npx wrangler secret put GMAIL_CLIENT_SECRET --config wrangler.production.toml
```

---

## Verifying the Deployment

After deploying, you can verify that the environment variables and database bindings are set up correctly:

1.  Open `https://your-worker-domain.workers.dev/api/health` in your browser.
2.  Review the JSON response:
    ```json
    {
      "status": "healthy",
      "worker": "Cloudflare",
      "timestamp": "2026-05-26T12:00:00Z",
      "config": {
        "jwtSecretSet": true,
        "googleClientIdSet": true,
        "gmailClientSecretSet": true
      }
    }
    ```
    *If any setting is `false`, the secrets were not uploaded correctly. Re-run `wrangler secret put` with the correct configurations.*
