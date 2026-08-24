
# RecoverFlow — AI-Powered Revenue Recovery Agent

RecoverFlow is a production-grade AI agent that detects failed and at-risk payments, reasons about why they failed, and executes a safe, policy-governed recovery workflow — built on a robust Node.js/SQLite backend with a real-time dashboard and full decision audit trail.

Built for Razorpay's AI Builder Buildathon — Track 3: AI Revenue Recovery. Evolved from an earlier full-stack finance dashboard (ExpenseFlow) into a focused agentic system for revenue recovery.

## ✨ Key Features

- **Detect → Reason → Decide → Act → Track Loop**: The core agent pipeline. Failed-payment events are caught (Detect), analyzed by an AI layer against failure type and customer history (Reason), gated by a deterministic policy engine (Decide), executed as a bounded action (Act), and logged to a full audit trail with the resolution outcome (Track).
- **Deterministic Policy Engine**: The AI recommends a recovery strategy, but never has final authority over money movement. Hard-coded rules govern execution — e.g. auto-retry is blocked after 3 failed attempts, payments above ₹50,000 require manager sign-off before any action, and customers with a chronic failure history are automatically routed to alternative payment methods instead of repeated retries.
- **Failure Simulator**: Injects realistic synthetic failed-payment events (bank timeout, insufficient funds, expired card) with the same JSON payload shape as a real payment gateway webhook, so the full agent pipeline can be demonstrated without live transactions.
- **Audit Trace Inspector**: Click into any payment to see its complete Detect → Reason → Decide → Act → Track timeline — what was detected, what the AI recommended, what the policy engine decided (and why, including any overrides), what action was taken, and the final outcome.
- **Human-in-the-Loop Approval**: High-value or policy-flagged payments surface an "Approve & Send" control on the dashboard instead of executing automatically, so a human stays in control of high-stakes actions.
- **Live Recovery Dashboard**: Four core metrics tracked in real time — Total Revenue, Revenue Recovered, Revenue at Risk, and Recovery Rate — plus a customer registry with payment-history profiles used by the policy engine.
- **Idempotent Architecture**: Recovery actions (retries, reminders, escalations) use an `X-Idempotency-Key` interceptor to prevent duplicate execution — critical for a system that takes real actions on payments.
- **Integer Storage Layer**: Monetary values are stored as integers (minor units) to eliminate floating-point rounding errors, carried over from the original financial dashboard architecture.

## 🧠 How It Works

1. **Detect** — A payment failure event (real webhook or simulated) is caught by the backend.
2. **Reason** — The AI layer inspects the failure reason and the customer's payment-history profile, and drafts a recommended recovery strategy and, where relevant, customer-facing message copy.
3. **Decide** — The recommendation passes through `policyEngine.js`, a deterministic rule set that can approve, override, or block the AI's suggestion. Example rules:
   - Amount > ₹50,000 → require human approval before any action.
   - `attempt_count >= 3` → block further auto-retry, switch to alternative payment method (avoids gateway fees and card-block risk).
   - `payment_history_summary === 'frequent_failures'` → skip auto-retry entirely, route straight to alternative payment method outreach.
4. **Act** — Approved actions execute: auto-retry, a personalized reminder message, an alternative payment link, or escalation to a human.
5. **Track** — The outcome (recovered, still failing, escalated) is recorded and reflected live in the dashboard metrics and audit log.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+) — dark glassmorphism dashboard UI.
- **Backend**: Node.js, Express.js.
- **Database**: SQLite3 (`better-sqlite3`) in WAL (Write-Ahead Logging) mode for concurrent read/write stability. Core tables: `payments`, `customers`, `recovery_attempts`, `policies`, `audit_logs`.
- **AI Layer**: LLM-based reasoning for strategy recommendation and message drafting, gated by the deterministic policy engine for execution authority.
- **Deployment**: Dockerized, integrated with `render.yaml` for 1-click cloud deployment.

## 🚀 Running Locally

1. **Install Dependencies**:
   Open a terminal in the `backend` folder and run:
   ```bash
   npm install
   ```
2. **Start the Server**:
   ```bash
   npm start
   ```
3. **Access the App**:
   Open your browser and navigate to:
   `http://localhost:3000`

## ☁️ Deployment

This project includes a `Dockerfile` and a `render.yaml` blueprint.

To deploy on Render.com:
1. Push this repository to GitHub.
2. Create a **New Blueprint** on Render and link the repository.
3. Render will handle the Node+SQLite containerization automatically.

*(Note: On the free tier of Render, local SQLite database files will reset when the instance goes dormant. For permanent retention, upgrade to a persistent disk or route the DB to a free external PostgreSQL provider.)*

## 📌 Project Context

Originally built as ExpenseFlow, a personal finance dashboard with multi-currency support and budget tracking. Evolved into RecoverFlow for Razorpay's AI Builder Buildathon (Track 3: AI Revenue Recovery), repurposing the existing idempotent, integer-safe backend architecture into an AI agent for automated payment recovery.
