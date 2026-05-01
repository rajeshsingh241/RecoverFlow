# test id -BVAK42N

# ExpenseFlow — Professional Expense Tracker Dashboard

ExpenseFlow is a production-grade, full-stack personal finance dashboard built with a sophisticated glassmorphism UI, a robust SQLite backend, and multi-currency support. It provides intelligent budget tracking, dynamic analytics, and category-based insights.

## ✨ Key Features

- **Multi-Currency Engine**: Log expenses in INR, USD, EUR, GBP, or JPY. The dashboard normalizes and aggregates all totals into a single, unified display currency using server-configured conversion rates.
- **Dynamic 30-Day Budgeting**: Set a 30-day rolling budget. Visual progress bars turn from green to red when you overspend, with a notification system alerting you at 80% and 100% usage.
- **Advanced Dashboard UI**: A Single Page Application (SPA) utilizing a modern, dark-themed glassmorphism aesthetic. It features active sidebars, micro-animations, color-coded badges, and top-tier responsiveness.
- **Idempotent Architecture**: Safely duplicate-proof. Uses an `X-Idempotency-Key` interceptor to prevent double-charging or accidental form double-submissions from the client side.
- **Integer Storage Layer**: Monetary values are safely handled as integers (minor units) on the robust SQLite backend to eliminate dangerous JavaScript floating-point rounding errors.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+). Zero bloat, blazing fast.
- **Backend**: Node.js, Express.js.
- **Database**: SQLite3 (`better-sqlite3`) executing in WAL (Write-Ahead Logging) mode for concurrent read/write stability.
- **Deployment**: Dockerized, integrated with `render.yaml` for 1-click cloud deployments without dev-ops overhead.

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

*(Note: On the free tier of Render, local SQLite database files will reset when the instance goes dormant. For permanent retention, upgrade to a persistent disk or route the DB to a free external postgresSQL provider).*
