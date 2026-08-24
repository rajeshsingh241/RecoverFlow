const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

/**
 * Service to execute recovery actions (retry, send message, escalate)
 * and update payments, attempts, and audit logs.
 */
async function executeRecoveryAction({ paymentId, action, messageDraft, authorizedBy }) {
  const db = getDb();
  
  // Load payment and customer details
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new Error('Payment not found');
  
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(payment.customer_id);
  if (!customer) throw new Error('Customer not found');

  const attemptId = 'att_' + uuidv4().substring(0, 8);
  const auditIdPrefix = 'aud_' + uuidv4().substring(0, 8) + '_';
  
  const timestamp = new Date().toISOString();
  
  // Transaction context
  db.transaction(() => {
    // 1. Log action execution start in audit logs
    db.prepare(`
      INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditIdPrefix + '1',
      paymentId,
      'action_executed',
      `Authorized action '${action}' initiated. Agent: ${authorizedBy}.`,
      action,
      'IN_PROGRESS',
      timestamp
    );

    // 2. Perform actions depending on strategy
    if (action === 'retry') {
      const newAttemptCount = payment.attempt_count + 1;
      
      // Simulate gateway retry outcome (75% success for bank_timeout, 15% for insufficient_funds if forced)
      let isSuccess = false;
      if (payment.failure_reason_code === 'bank_timeout') {
        isSuccess = Math.random() < 0.75;
      } else {
        isSuccess = Math.random() < 0.15;
      }

      const finalStatus = isSuccess ? 'recovered' : 'failed';
      
      // Update payment details
      db.prepare(`
        UPDATE payments 
        SET status = ?, attempt_count = ?, updated_at = ?
        WHERE id = ?
      `).run(finalStatus, newAttemptCount, timestamp, paymentId);

      // Log attempt
      db.prepare(`
        INSERT INTO recovery_attempts (id, payment_id, strategy, authorized_by, message_draft, status, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attemptId,
        paymentId,
        'retry',
        authorizedBy,
        null,
        isSuccess ? 'success' : 'failed',
        timestamp,
        timestamp
      );

      // Log audit outcome
      db.prepare(`
        INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditIdPrefix + '2',
        paymentId,
        'recovery_outcome',
        isSuccess 
          ? `Retry attempt #${newAttemptCount} succeeded. Status resolved to RECOVERED.`
          : `Retry attempt #${newAttemptCount} failed. Gateway returned transaction decline error.`,
        'retry',
        isSuccess ? 'RECOVERED' : 'FAILED',
        timestamp
      );

    } else if (action === 'send_reminder' || action === 'alternative_payment_method') {
      // Mark payment status as 'recovering'
      db.prepare(`
        UPDATE payments 
        SET status = 'recovering', updated_at = ?
        WHERE id = ?
      `).run(timestamp, paymentId);

      // Log messaging attempt as pending customer check-out
      db.prepare(`
        INSERT INTO recovery_attempts (id, payment_id, strategy, authorized_by, message_draft, status, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attemptId,
        paymentId,
        action,
        authorizedBy,
        messageDraft,
        'pending',
        null,
        timestamp
      );

      const channel = action === 'send_reminder' ? 'WhatsApp' : 'SMS';
      db.prepare(`
        INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditIdPrefix + '2',
        paymentId,
        'action_executed',
        `Dispatched personalized reminder draft to ${customer.name} via ${channel}. Awaiting customer payment link click.`,
        action,
        'SENT',
        timestamp
      );

    } else if (action === 'escalate_to_human') {
      // Mark payment status as 'escalated'
      db.prepare(`
        UPDATE payments 
        SET status = 'escalated', updated_at = ?
        WHERE id = ?
      `).run(timestamp, paymentId);

      // Log attempt
      db.prepare(`
        INSERT INTO recovery_attempts (id, payment_id, strategy, authorized_by, message_draft, status, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attemptId,
        paymentId,
        'escalate_to_human',
        authorizedBy,
        messageDraft,
        'success',
        timestamp,
        timestamp
      );

      db.prepare(`
        INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditIdPrefix + '2',
        paymentId,
        'action_executed',
        `Flagged transaction for manual account manager contact. Notification queued in CRM system.`,
        'escalate_to_human',
        'ESCALATED',
        timestamp
      );
    }
  })();

  // Return the newly updated payment and log details
  return db.prepare(`
    SELECT p.*, c.name as customer_name 
    FROM payments p
    JOIN customers c ON p.customer_id = c.id
    WHERE p.id = ?
  `).get(paymentId);
}

module.exports = { executeRecoveryAction };
