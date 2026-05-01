const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { validateExpense, VALID_CATEGORIES, VALID_CURRENCIES, CURRENCY_MINOR_UNITS, CURRENCY_SYMBOLS } = require('../validators/expense');

const router = express.Router();

/**
 * POST /expenses
 * Create a new expense entry.
 * 
 * Body: { amount, currency?, category, description?, date, idempotency_key? }
 * Header: X-Idempotency-Key (optional, for retry safety)
 */
router.post('/', (req, res) => {
  const validation = validateExpense(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.errors,
    });
  }

  const { amount_minor, currency, category, description, date } = validation.data;
  const id = uuidv4();

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO expenses (id, amount_minor, currency, category, description, date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(id, amount_minor, currency, category, description, date);
  } catch (err) {
    console.error('Database insert error:', err.message);
    return res.status(500).json({ error: 'Failed to create expense.' });
  }

  const minorMultiplier = CURRENCY_MINOR_UNITS[currency] || 100;
  const expense = {
    id,
    amount: (amount_minor / minorMultiplier).toFixed(currency === 'JPY' ? 0 : 2),
    amount_minor,
    currency,
    currency_symbol: CURRENCY_SYMBOLS[currency] || currency,
    category,
    description,
    date,
    created_at: new Date().toISOString(),
  };

  res.status(201).json({ data: expense });
});

/**
 * GET /expenses
 * Retrieve a list of expenses with optional filtering and sorting.
 * 
 * Query params:
 *   category - Filter by exact category name
 *   sort     - 'date_desc' (default) or 'date_asc'
 */
router.get('/', (req, res) => {
  const { category, sort } = req.query;

  let query = 'SELECT * FROM expenses';
  const params = [];
  const conditions = [];

  // Filter by category
  if (category && typeof category === 'string' && category.trim()) {
    conditions.push('category = ?');
    params.push(category.trim());
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Sort by date
  if (sort === 'date_asc') {
    query += ' ORDER BY date ASC, created_at ASC';
  } else {
    // Default: newest first
    query += ' ORDER BY date DESC, created_at DESC';
  }

  const db = getDb();
  let rows;

  try {
    rows = db.prepare(query).all(...params);
  } catch (err) {
    console.error('Database query error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch expenses.' });
  }

  // Convert minor units back to display amounts
  const expenses = rows.map((row) => {
    const minorMultiplier = CURRENCY_MINOR_UNITS[row.currency] || 100;
    return {
      id: row.id,
      amount: (row.amount_minor / minorMultiplier).toFixed(row.currency === 'JPY' ? 0 : 2),
      amount_minor: row.amount_minor,
      currency: row.currency,
      currency_symbol: CURRENCY_SYMBOLS[row.currency] || row.currency,
      category: row.category,
      description: row.description,
      date: row.date,
      created_at: row.created_at,
    };
  });

  // Compute totals grouped by currency
  const totalsByCurrency = {};
  expenses.forEach((exp) => {
    if (!totalsByCurrency[exp.currency]) {
      totalsByCurrency[exp.currency] = {
        currency: exp.currency,
        symbol: exp.currency_symbol,
        total_minor: 0,
      };
    }
    totalsByCurrency[exp.currency].total_minor += exp.amount_minor;
  });

  const totals = Object.values(totalsByCurrency).map((t) => {
    const minorMultiplier = CURRENCY_MINOR_UNITS[t.currency] || 100;
    return {
      currency: t.currency,
      symbol: t.symbol,
      total: (t.total_minor / minorMultiplier).toFixed(t.currency === 'JPY' ? 0 : 2),
    };
  });

  res.json({
    data: expenses,
    meta: {
      count: expenses.length,
      totals,
    },
  });
});

/**
 * GET /expenses/categories
 * Return the list of valid categories.
 */
router.get('/categories', (_req, res) => {
  res.json({ data: VALID_CATEGORIES });
});

/**
 * GET /expenses/currencies
 * Return the list of valid currencies.
 */
router.get('/currencies', (_req, res) => {
  res.json({
    data: VALID_CURRENCIES.map((c) => ({
      code: c,
      symbol: CURRENCY_SYMBOLS[c],
    })),
  });
});

module.exports = router;
