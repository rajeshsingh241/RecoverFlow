const { getDb } = require('../db');

/**
 * Idempotency middleware for POST requests.
 * 
 * Clients send an `X-Idempotency-Key` header (or `idempotency_key` in the body).
 * If the key has been seen before, the cached response is returned immediately,
 * preventing duplicate expense entries from retries, double-clicks, or page refreshes.
 * 
 * If no key is provided, the request proceeds normally (no idempotency guarantee).
 */
function idempotency(req, res, next) {
  if (req.method !== 'POST') {
    return next();
  }

  const key = req.headers['x-idempotency-key'] || req.body?.idempotency_key;

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    // No idempotency key provided — proceed without idempotency
    return next();
  }

  const trimmedKey = key.trim();
  req.idempotencyKey = trimmedKey;

  const db = getDb();

  // Check for existing key
  const existing = db.prepare(
    'SELECT response_status, response_body FROM idempotency_keys WHERE key = ?'
  ).get(trimmedKey);

  if (existing) {
    // Return the cached response
    const body = JSON.parse(existing.response_body);
    return res.status(existing.response_status).json(body);
  }

  // Override res.json to capture and store the response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Only cache successful creation responses
    if (res.statusCode >= 200 && res.statusCode < 300 && req.idempotencyKey) {
      try {
        const expense_id = body?.data?.id || body?.id || 'unknown';
        db.prepare(
          'INSERT OR IGNORE INTO idempotency_keys (key, expense_id, response_status, response_body) VALUES (?, ?, ?, ?)'
        ).run(req.idempotencyKey, expense_id, res.statusCode, JSON.stringify(body));
      } catch (err) {
        console.error('Failed to store idempotency key:', err.message);
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = { idempotency };
