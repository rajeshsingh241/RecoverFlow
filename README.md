# Expense Tracker

A minimal full-stack personal finance tool for recording and reviewing expenses, built with production-quality practices.

**Live Demo**: _(deployment link to be added)_

---

## Quick Start

```bash
# Install dependencies
cd backend
npm install

# Start the server (serves both API and frontend)
npm start

# Open in browser
# http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

---

## Project Structure

```
femno/
├── backend/
│   ├── src/
│   │   ├── index.js              # Express server + static file serving
│   │   ├── db.js                 # SQLite setup & schema
│   │   ├── routes/expenses.js    # POST & GET /expenses endpoints
│   │   ├── middleware/idempotency.js  # Retry-safe request handling
│   │   └── validators/expense.js # Input validation + money conversion
│   ├── tests/
│   │   └── expenses.test.js      # Integration tests (Jest + Supertest)
│   └── package.json
├── frontend/
│   ├── index.html                # UI structure
│   ├── style.css                 # Dark glassmorphism theme
│   └── app.js                    # Client-side logic
└── README.md
```

---

## Key Design Decisions

### 1. Money Handling — Integer Minor Units

Floating-point arithmetic is unsafe for money (e.g., `0.1 + 0.2 ≠ 0.3`). All monetary amounts are stored as **integers in minor units** (paise for INR, cents for USD/EUR/GBP, whole units for JPY).

- `₹250.50` → stored as `25050` (paise)
- `$10.99` → stored as `1099` (cents)
- `¥1500` → stored as `1500` (no minor units)

Conversion happens at the API boundary: the client sends decimal amounts, and the server converts to/from minor units internally.

### 2. Idempotency — Safe Retries

Users may double-click submit, refresh the page after posting, or experience network retries. The API supports an `X-Idempotency-Key` header:

- Each form submission generates a unique UUID as the idempotency key.
- The server checks if the key has been used before. If so, it returns the **original cached response** (same expense, same ID) without creating a duplicate.
- Keys are stored in a separate `idempotency_keys` table with the associated response.

This guarantees **exactly-once semantics** for expense creation under real-world conditions.

### 3. Persistence — SQLite (better-sqlite3)

| Option | Verdict |
|--------|---------|
| In-memory | ❌ Data lost on restart |
| JSON file | ❌ No ACID, race conditions |
| SQLite | ✅ ACID, zero config, durable, real SQL |
| PostgreSQL | Overkill for single-user tool |

SQLite with WAL mode provides excellent read performance and crash safety. `better-sqlite3` uses a synchronous API, which is simpler and faster for single-user workloads (no connection pool  needed).

### 4. Multi-Currency Support

Supports INR, USD, EUR, GBP, and JPY. Each expense stores its currency, and totals are aggregated per currency. This avoids incorrect cross-currency arithmetic (you can't simply add ₹500 + $10).

### 5. Fixed Category List

Categories are predefined (Food & Dining, Transport, Groceries, etc.) rather than free-text. This ensures consistent filtering and prevents data fragmentation from typos or variations ("food" vs "Food" vs "dining").

### 6. Validation — Defense in Depth

Validation happens at **two layers**:
- **Client-side**: Immediate feedback (required fields, positive amounts, no future dates).
- **Server-side**: Authoritative validation (same checks + category allowlist + decimal precision per currency). The server never trusts client data.

---

## API Reference

### `POST /expenses`

Create a new expense.

**Headers:**
- `Content-Type: application/json`
- `X-Idempotency-Key: <uuid>` _(optional but recommended)_

**Body:**
```json
{
  "amount": 250.50,
  "currency": "INR",
  "category": "Food & Dining",
  "description": "Lunch at cafe",
  "date": "2025-04-28"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "amount": "250.50",
    "amount_minor": 25050,
    "currency": "INR",
    "currency_symbol": "₹",
    "category": "Food & Dining",
    "description": "Lunch at cafe",
    "date": "2025-04-28",
    "created_at": "2025-04-28T10:30:00.000Z"
  }
}
```

### `GET /expenses`

List expenses with optional filtering and sorting.

**Query Parameters:**
- `category` — Filter by exact category name
- `sort` — `date_desc` (default) or `date_asc`

**Response (200):**
```json
{
  "data": [ /* array of expenses */ ],
  "meta": {
    "count": 42,
    "totals": [
      { "currency": "INR", "symbol": "₹", "total": "15250.00" },
      { "currency": "USD", "symbol": "$", "total": "120.50" }
    ]
  }
}
```

### `GET /expenses/categories`

Returns the list of valid categories.

### `GET /expenses/currencies`

Returns the list of supported currencies with symbols.

### `GET /health`

Health check endpoint.

---

## Trade-offs (Due to Timebox)

| What I did | What I'd do with more time |
|------------|---------------------------|
| SQLite single file | PostgreSQL for multi-user deployment |
| Static frontend served by Express | Separate SPA with a build step (React/Vue) |
| No authentication | OAuth2 / session-based auth |
| No expense editing/deletion | Full CRUD with soft-delete history |
| Totals computed on every GET | Materialized summary tables or caching |
| Idempotency keys stored forever | TTL-based cleanup (e.g., expire after 24h) |
| Basic category breakdown | Charts (bar/pie) with a library like Chart.js |
| No pagination | Cursor-based pagination for large datasets |

## What I Intentionally Did Not Do

- **No ORM**: For a schema this simple, raw SQL is clearer and has fewer abstraction leaks.
- **No TypeScript**: Would add value at scale, but adds build complexity for a small project.
- **No Docker**: Keeps the setup simpler; SQLite doesn't need a container.
- **No frontend framework**: Vanilla JS keeps the bundle at zero and the code easy to audit.

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: SQLite (via better-sqlite3)
- **Testing**: Jest + Supertest
- **Frontend**: Vanilla HTML/CSS/JS
- **Font**: Inter (Google Fonts)
