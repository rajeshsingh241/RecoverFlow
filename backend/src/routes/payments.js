const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { analyzeFailure } = require('../services/ai');
const { evaluatePolicy } = require('../services/policyEngine');
const { executeRecoveryAction } = require('../services/actionRunner');
const { CURRENCY_MINOR_UNITS, CURRENCY_SYMBOLS } = require('../validators/expense');

const router = express.Router();

// Approximate exchange rates to INR for stats normalization
const RATES_TO_INR = {
  INR: 1.0,
  USD: 83.5,
  EUR: 91.0,
  GBP: 105.5,
  JPY: 0.56
};

function convertToINRMinor(amountMinor, currency) {
  const rate = RATES_TO_INR[currency] || 1.0;
  let inINR = Number(amountMinor) * rate;
  if (currency === 'JPY') {
    inINR = inINR * 100; // JPY minor unit is 1, convert to paise equivalent
  }
  return Math.round(inINR);
}

/**
 * GET /api/payments
 * Retrieve payments list, dashboard statistics, and summaries.
 */
router.get('/', (req, res) => {
  const { status, search } = req.query;
  const db = getDb();

  let query = `
    SELECT p.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM payments p
    JOIN customers c ON p.customer_id = c.id
  `;
  const params = [];
  const conditions = [];

  if (status && typeof status === 'string' && status.trim() !== 'all') {
    conditions.push('p.status = ?');
    params.push(status.trim());
  }

  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('c.name LIKE ?');
    params.push(`%${search.trim()}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY p.updated_at DESC';

  try {
    const payments = db.prepare(query).all(...params);

    // Calculate merchant statistics in INR minor units
    // status values: 'success', 'failed', 'recovering', 'recovered', 'pending_approval', 'escalated'
    let totalRevenueINR = 0;
    let revenueRecoveredINR = 0;
    let revenueAtRiskINR = 0;

    let totalFailedCount = 0;
    let recoveredCount = 0;

    const allPaymentsRaw = db.prepare('SELECT * FROM payments').all();
    allPaymentsRaw.forEach(p => {
      const inINRMinor = convertToINRMinor(p.amount_minor, p.currency);
      
      if (p.status === 'success') {
        totalRevenueINR += inINRMinor;
      } else if (p.status === 'recovered') {
        totalRevenueINR += inINRMinor;
        revenueRecoveredINR += inINRMinor;
        recoveredCount++;
        totalFailedCount++; // A recovered payment was originally failed
      } else if (['failed', 'recovering', 'pending_approval', 'escalated'].includes(p.status)) {
        revenueAtRiskINR += inINRMinor;
        totalFailedCount++;
      }
    });

    const recoveryRate = totalFailedCount > 0 
      ? Math.round((recoveredCount / totalFailedCount) * 100) 
      : 0;

    // Format totals to standard currency numbers
    res.json({
      data: payments,
      meta: {
        stats: {
          total_revenue: totalRevenueINR / 100,
          revenue_recovered: revenueRecoveredINR / 100,
          revenue_at_risk: revenueAtRiskINR / 100,
          recovery_rate: recoveryRate
        }
      }
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ error: 'Failed to fetch payments.' });
  }
});

/**
 * GET /api/payments/customers
 * Return the list of customers
 */
router.get('/customers', (_req, res) => {
  const db = getDb();
  try {
    const customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
    res.json({ data: customers });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ error: 'Failed to fetch customers.' });
  }
});

/**
 * GET /api/payments/:id/audit
 * Fetch AI decisions, policy logs, and recovery attempts for a payment.
 */
router.get('/:id/audit', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  try {
    const payment = db.prepare(`
      SELECT p.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.payment_history_summary
      FROM payments p
      JOIN customers c ON p.customer_id = c.id
      WHERE p.id = ?
    `).get(id);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE payment_id = ? ORDER BY created_at ASC').all(id);
    const recoveryAttempts = db.prepare('SELECT * FROM recovery_attempts WHERE payment_id = ? ORDER BY created_at DESC').all(id);

    res.json({
      payment,
      audit_logs: auditLogs,
      recovery_attempts: recoveryAttempts
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit data.' });
  }
});

/**
 * POST /api/payments/simulate
 * Inject a synthetic payment failure, run AI analysis, run policy engine, and act.
 */
router.post('/simulate', async (req, res) => {
  const { customer_id, amount, currency, failure_reason_code } = req.body;
  const db = getDb();

  if (!customer_id || !amount || !currency || !failure_reason_code) {
    return res.status(400).json({ error: 'Missing required simulation fields.' });
  }

  // Create payment record
  const paymentId = 'pay_' + uuidv4().substring(0, 8);
  const minorMultiplier = CURRENCY_MINOR_UNITS[currency] || 100;
  const amountMinor = Math.round(Number(amount) * minorMultiplier);
  const timestamp = new Date().toISOString();

  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) {
      return res.status(400).json({ error: 'Customer not found.' });
    }

    // Insert failed payment record
    db.prepare(`
      INSERT INTO payments (id, customer_id, amount_minor, currency, status, failure_reason_code, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'failed', ?, 1, ?, ?)
    `).run(paymentId, customer_id, amountMinor, currency, failure_reason_code, timestamp, timestamp);

    // Audit Log: Failure detected
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    const formattedAmount = `${symbol}${amount}`;
    db.prepare(`
      INSERT INTO audit_logs (id, payment_id, event_type, reason, created_at)
      VALUES (?, ?, 'failure_detected', ?, ?)
    `).run(
      'aud_' + uuidv4().substring(0, 8),
      paymentId,
      `Payment of ${formattedAmount} by customer ${customer.name} failed with gateway error: ${failure_reason_code.toUpperCase()}.`,
      timestamp
    );

    // Call AI Agent
    const aiResponse = await analyzeFailure({
      customerName: customer.name,
      historySummary: customer.payment_history_summary,
      amountMinor,
      currency,
      failureCode: failure_reason_code,
      attemptCount: 1
    });

    // Audit Log: AI Recommendation
    db.prepare(`
      INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, created_at)
      VALUES (?, ?, 'ai_recommendation', ?, ?, ?)
    `).run(
      'aud_' + uuidv4().substring(0, 8),
      paymentId,
      `AI Agent analyzed failure. Reasoning: "${aiResponse.reasoning}" Message Draft: "${aiResponse.message_draft}"`,
      aiResponse.strategy,
      timestamp
    );

    // Evaluate Policy Engine
    const paymentRecord = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    const policyResult = evaluatePolicy(paymentRecord, customer, aiResponse.strategy);

    // Audit Log: Policy Evaluation
    db.prepare(`
      INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
      VALUES (?, ?, 'policy_evaluation', ?, ?, ?, ?)
    `).run(
      'aud_' + uuidv4().substring(0, 8),
      paymentId,
      policyResult.reason,
      policyResult.action,
      policyResult.requiresApproval ? 'REQUIRES_APPROVAL' : 'AUTHORIZED',
      timestamp
    );

    // Action execution gate
    let finalPaymentState = paymentRecord;
    if (policyResult.requiresApproval) {
      // Update payment state to pending_approval
      db.prepare("UPDATE payments SET status = 'pending_approval' WHERE id = ?").run(paymentId);
      finalPaymentState = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    } else if (policyResult.authorized) {
      // Execute authorized action automatically
      finalPaymentState = await executeRecoveryAction({
        paymentId,
        action: policyResult.action,
        messageDraft: aiResponse.message_draft,
        authorizedBy: 'policy_engine'
      });
    }

    res.status(201).json({
      payment: finalPaymentState,
      ai_decision: aiResponse,
      policy: policyResult
    });

  } catch (err) {
    console.error('Simulation error:', err);
    res.status(500).json({ error: 'Failed to complete simulation run.' });
  }
});

/**
 * POST /api/payments/:id/approve
 * Human sign-off/approve a pending action.
 */
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { custom_message } = req.body;
  const db = getDb();

  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });

    if (payment.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Payment does not require approval.' });
    }

    // Retrieve the latest AI recommendation from audit logs to get recommended strategy/draft
    const logs = db.prepare('SELECT * FROM audit_logs WHERE payment_id = ? AND event_type = ? ORDER BY created_at DESC').all(id, 'ai_recommendation');
    let strategy = 'send_reminder';
    let draft = custom_message || 'Overdue payment reminder';

    if (logs.length > 0) {
      strategy = logs[0].action_taken || 'send_reminder';
      if (!custom_message) {
        // Parse message draft out of log text if possible
        const msgMatch = logs[0].reason.match(/Message Draft: "(.*)"/);
        if (msgMatch && msgMatch[1]) {
          draft = msgMatch[1];
        }
      }
    }

    // Execute the action manually
    const updatedPayment = await executeRecoveryAction({
      paymentId: id,
      action: strategy,
      messageDraft: draft,
      authorizedBy: 'human_approver'
    });

    res.json({ data: updatedPayment });

  } catch (err) {
    console.error('Approve action error:', err);
    res.status(500).json({ error: 'Failed to approve recovery action.' });
  }
});

/**
 * POST /api/payments/:id/retry
 * Manually trigger a transaction retry.
 */
router.post('/:id/retry', async (req, res) => {
  const { id } = req.params;
  try {
    const updatedPayment = await executeRecoveryAction({
      paymentId: id,
      action: 'retry',
      messageDraft: null,
      authorizedBy: 'manual_trigger'
    });
    res.json({ data: updatedPayment });
  } catch (err) {
    console.error('Manual retry error:', err);
    res.status(500).json({ error: err.message || 'Failed to trigger manual retry.' });
  }
});

/**
 * POST /api/payments/:id/simulate-checkout
 * Simulate customer paying through SMS/WhatsApp payment links.
 */
router.post('/:id/simulate-checkout', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const timestamp = new Date().toISOString();

  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });

    if (!['failed', 'recovering', 'escalated'].includes(payment.status)) {
      return res.status(400).json({ error: 'Only failed or active recovery payments can be checked out.' });
    }

    db.transaction(() => {
      // 1. Update payment status to recovered
      db.prepare(`
        UPDATE payments 
        SET status = 'recovered', updated_at = ?
        WHERE id = ?
      `).run(timestamp, id);

      // 2. Mark pending recovery attempts as success
      db.prepare(`
        UPDATE recovery_attempts 
        SET status = 'success', completed_at = ?
        WHERE payment_id = ? AND status = 'pending'
      `).run(timestamp, id);

      // 3. Log recovery outcome in audit logs
      db.prepare(`
        INSERT INTO audit_logs (id, payment_id, event_type, reason, result, created_at)
        VALUES (?, ?, 'recovery_outcome', 'Customer clicked outreach link and completed checkout successfully.', 'RECOVERED', ?)
      `).run(
        'aud_' + uuidv4().substring(0, 8),
        id,
        timestamp
      );
    })();

    const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    res.json({ data: updated });

  } catch (err) {
    console.error('Checkout simulation error:', err);
    res.status(500).json({ error: 'Failed to simulate checkout.' });
  }
});

module.exports = router;
