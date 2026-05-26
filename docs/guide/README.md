# Quick Start Guide

Welcome to Gitpaid! This guide will help you set up and deploy your own compliant Ontario payroll engine in under 10 minutes.

Gitpaid is a **self-hosted**, completely **free**, and **open-source** payroll system. By deploying it on your own Cloudflare account, you maintain 100% data privacy and pay $0 for hosting.

---

## High-Level Architecture

Gitpaid is built on the modern Cloudflare serverless stack:
*   **Frontend**: React Single Page Application (Vite, TypeScript, TailwindCSS)
*   **Backend**: Hono REST API running as a Cloudflare Worker
*   **Database**: Cloudflare D1 (SQLite-compatible serverless database)
*   **Auth & Email**: Google OAuth (GIS) & Gmail API integrations

---

## 3-Step Setup Overview

To get Gitpaid up and running in production, you'll complete these three key phases:

### 1. Cloudflare Account Setup
You'll need a free Cloudflare account to host your backend worker, host your database, and serve your static frontend.
*   Compute and storage costs fall well within Cloudflare's generous free tier for small companies.

### 2. Google OAuth & Gmail Setup
Google Identity Services are used to secure your administrator login, and the Gmail API is utilized to email professional pay stub PDFs securely to your employees.
*   You'll create a Google Cloud console project, retrieve a Client ID, and establish Gmail consent.
*   *For local development and initial testing, this step can be skipped by enabling the Live Testing Bypass.*

### 3. One-Click Repository Deployment
Connect your Git fork and use the automated wizard to deploy the stack to your Cloudflare account. Cloudflare handles provisioning resources, database migrations, and SSL routing automatically.

---

## Next Steps

To begin setting up your project, choose one of the following guides from the navigation sidebar:

*   **[Local Development Setup](local)**: Run the project locally on your machine to test it out before deploying.
*   **[Google Console & OAuth Setup](google)**: Configure your Google Developer Account for logins and Gmail stubs.
*   **[Cloudflare Workers & D1 Deployment](cloudflare)**: Deploy your live production instance to Cloudflare.
