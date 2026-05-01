const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');
const { idempotency } = require('./middleware/idempotency');
const expensesRouter = require('./routes/expenses');

const app = express();

// --- Middleware ---
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Idempotency-Key'],
}));
app.use(express.json());
app.use(idempotency);

// --- Serve frontend (static files from ../frontend) ---
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// --- API Routes ---
app.use('/expenses', expensesRouter);

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- 404 for unknown API routes ---
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Global error handler ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start server (only if not imported for testing) ---
if (require.main === module) {
  // Initialize DB before starting
  getDb();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✓ Expense Tracker API running on http://localhost:${PORT}`);
    console.log(`✓ Frontend served at http://localhost:${PORT}`);
  });
}

module.exports = app;
