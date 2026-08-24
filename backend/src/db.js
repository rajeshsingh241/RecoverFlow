const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

/**
 * Initialize and return the SQLite database connection.
 * Creates the data directory and tables if they don't exist.
 * 
 * @param {string} [dbPath] - Optional path for the database file. 
 *                             Defaults to ./data/expenses.db
 *                             Pass ':memory:' for in-memory (tests).
 */
function getDb(dbPath) {
  if (db) return db;

  if (!dbPath) {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, 'expenses.db');
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      payment_history_summary TEXT, -- 'high_success_rate', 'first_time_buyer', 'frequent_failures'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL, -- 'success', 'failed', 'recovering', 'recovered', 'pending_approval'
      failure_reason_code TEXT, -- 'insufficient_funds', 'expired_card', 'bank_timeout', 'subscription_mandate_failure', 'B2B_invoice_overdue'
      attempt_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);

    CREATE TABLE IF NOT EXISTS recovery_attempts (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      strategy TEXT NOT NULL, -- 'retry', 'send_reminder', 'alternative_payment_method', 'escalate_to_human'
      authorized_by TEXT NOT NULL, -- 'policy_engine', 'human_approver'
      message_draft TEXT,
      status TEXT NOT NULL, -- 'pending', 'success', 'failed'
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      event_type TEXT NOT NULL, -- 'failure_detected', 'ai_recommendation', 'policy_evaluation', 'action_executed', 'recovery_outcome'
      reason TEXT NOT NULL,
      action_taken TEXT,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      expense_id TEXT,
      payment_id TEXT,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  seedData(db);

  return db;
}

/**
 * Seed data for demo purposes if customers table is empty
 */
function seedData(database) {
  const count = database.prepare('SELECT COUNT(*) as count FROM customers').get().count;
  if (count > 0) return; // DB already seeded

  console.log('Seeding demo database with mock customers and payments...');

  // Seed Customers
  const insertCustomer = database.prepare(`
    INSERT INTO customers (id, name, email, phone, payment_history_summary)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertCustomer.run('cust_1', 'Rahul Kumar', 'rahul.kumar@gmail.com', '+91 98765 43210', 'high_success_rate');
  insertCustomer.run('cust_2', 'Priya Sharma', 'priya.sharma@yahoo.com', '+91 91234 56789', 'frequent_failures');
  insertCustomer.run('cust_3', 'Amit Patel', 'amit.patel@hotmail.com', '+91 99887 76655', 'first_time_buyer');
  insertCustomer.run('cust_4', 'Vikram Singh', 'vikram.singh@outlook.com', '+91 98989 89898', 'high_success_rate');
  insertCustomer.run('cust_5', 'Deepa Nair', 'deepa.nair@corp.in', '+91 97654 32100', 'high_success_rate');

  // Seed Payments
  const insertPayment = database.prepare(`
    INSERT INTO payments (id, customer_id, amount_minor, currency, status, failure_reason_code, attempt_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAudit = database.prepare(`
    INSERT INTO audit_logs (id, payment_id, event_type, reason, action_taken, result, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAttempt = database.prepare(`
    INSERT INTO recovery_attempts (id, payment_id, strategy, authorized_by, message_draft, status, completed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  
  const getPastTime = (minutesAgo) => {
    const d = new Date(now.getTime() - minutesAgo * 60 * 1000);
    return d.toISOString();
  };

  // 1. Success Payment (Rahul Kumar)
  const payId1 = 'pay_1';
  insertPayment.run(payId1, 'cust_1', 1200000, 'INR', 'success', null, 1, getPastTime(120), getPastTime(120));

  // 2. Recovered Payment (Rahul Kumar) - failed first, retried successfully
  const payId2 = 'pay_2';
  insertPayment.run(payId2, 'cust_1', 320000, 'INR', 'recovered', 'bank_timeout', 2, getPastTime(90), getPastTime(80));

  insertAudit.run('aud_2_1', payId2, 'failure_detected', 'Payment of ₹3,200 failed with reason: BANK_TIMEOUT.', null, null, getPastTime(90));
  insertAudit.run('aud_2_2', payId2, 'ai_recommendation', 'AI evaluated BANK_TIMEOUT. Recommends auto-retry immediately: "This is a temporary gateway timeout, customer Rahul Kumar has a 95% payment success rate."', 'retry', null, getPastTime(89));
  insertAudit.run('aud_2_3', payId2, 'policy_evaluation', 'Policy Engine approved auto-retry: Amount (₹3,200) < ₹5,000 threshold and previous attempts (1) < 2.', 'retry', 'AUTHORIZED', getPastTime(88));
  insertAudit.run('aud_2_4', payId2, 'action_executed', 'Automatic transaction retry dispatched to gateway (Attempt 2/3).', 'retry', 'PENDING', getPastTime(85));
  insertAttempt.run('att_2', payId2, 'retry', 'policy_engine', null, 'success', getPastTime(80), getPastTime(85));
  insertAudit.run('aud_2_5', payId2, 'recovery_outcome', 'Retry successful. Gateway returned transaction success status.', 'retry', 'RECOVERED', getPastTime(80));

  // 3. Failed Payment - Insufficient Funds (Priya Sharma) -> reminder sent, awaiting customer action
  const payId3 = 'pay_3';
  insertPayment.run(payId3, 'cust_2', 450000, 'INR', 'failed', 'insufficient_funds', 1, getPastTime(60), getPastTime(50));

  insertAudit.run('aud_3_1', payId3, 'failure_detected', 'Payment of ₹4,500 failed with reason: INSUFFICIENT_FUNDS.', null, null, getPastTime(60));
  insertAudit.run('aud_3_2', payId3, 'ai_recommendation', 'AI evaluated INSUFFICIENT_FUNDS. Recommends sending a friendly Hinglish reminder with UPI/Netbanking alternative details to prompt fund arrangement.', 'send_reminder', null, getPastTime(59));
  insertAudit.run('aud_3_3', payId3, 'policy_evaluation', 'Policy Engine approved reminder: Retries are blocked for hard failures like insufficient funds, sending message is safe.', 'send_reminder', 'AUTHORIZED', getPastTime(58));
  
  const draftMsg = 'Hi Priya, looks like your payment of ₹4,500 failed due to insufficient funds. No worries, click here to retry using UPI or any other card: https://pay.flow/p_3';
  insertAttempt.run('att_3', payId3, 'send_reminder', 'policy_engine', draftMsg, 'pending', null, getPastTime(55));
  insertAudit.run('aud_3_4', payId3, 'action_executed', 'Hinglish WhatsApp reminder sent to Priya Sharma (+91 91234 56789).', 'send_reminder', 'SENT', getPastTime(55));

  // 4. Failed Payment - Subscription Mandate Failed (Amit Patel) -> retry limit reached, escalated to reminder
  const payId4 = 'pay_4';
  insertPayment.run(payId4, 'cust_3', 150000, 'INR', 'failed', 'subscription_mandate_failure', 3, getPastTime(45), getPastTime(30));

  insertAudit.run('aud_4_1', payId4, 'failure_detected', 'Payment of ₹1,500 failed with reason: MANDATE_FAIL (Attempt 3).', null, null, getPastTime(45));
  insertAudit.run('aud_4_2', payId4, 'ai_recommendation', 'AI suggests retrying via alternative payment link as the card mandate has failed repeatedly.', 'alternative_payment_method', null, getPastTime(44));
  insertAudit.run('aud_4_3', payId4, 'policy_evaluation', 'Policy Engine enforced: Max retries (3) reached. Blocked auto-retry and forced escalation to alternative payment offer.', 'alternative_payment_method', 'AUTHORIZED', getPastTime(43));
  
  const altMsg = 'Hi Amit, your auto-debit of ₹1,500 failed. Please complete the payment manually using this safe link to keep your services active: https://pay.flow/alt_4';
  insertAttempt.run('att_4', payId4, 'alternative_payment_method', 'policy_engine', altMsg, 'pending', null, getPastTime(40));
  insertAudit.run('aud_4_4', payId4, 'action_executed', 'Alternative payment method link sent to Amit Patel via SMS (+91 99887 76655).', 'alternative_payment_method', 'SENT', getPastTime(40));

  // 5. High-Value Payment Overdue - Human Approval Needed (Vikram Singh)
  const payId5 = 'pay_5';
  insertPayment.run(payId5, 'cust_4', 6500000, 'INR', 'pending_approval', 'B2B_invoice_overdue', 1, getPastTime(25), getPastTime(25));

  insertAudit.run('aud_5_1', payId5, 'failure_detected', 'B2B invoice payment of ₹65,000 is overdue.', null, null, getPastTime(25));
  insertAudit.run('aud_5_2', payId5, 'ai_recommendation', 'AI suggests calling the account manager and sending a formal reminder draft because client Vikram Singh is a high-value account.', 'send_reminder', null, getPastTime(24));
  insertAudit.run('aud_5_3', payId5, 'policy_evaluation', 'Policy Engine triggered warning: Transaction amount (₹65,000) exceeds ₹50,000 safety threshold. Halting automatic recovery. Human approval is required.', 'send_reminder', 'REQUIRES_APPROVAL', getPastTime(23));

  // 6. Expired Card (Deepa Nair) -> USD transaction
  const payId6 = 'pay_6';
  insertPayment.run(payId6, 'cust_5', 12000, 'USD', 'failed', 'expired_card', 1, getPastTime(15), getPastTime(15));
  insertAudit.run('aud_6_1', payId6, 'failure_detected', 'Payment of $120.00 failed with reason: EXPIRED_CARD.', null, null, getPastTime(15));
  insertAudit.run('aud_6_2', payId6, 'ai_recommendation', 'AI recommends sending card update reminder: "Card has expired. Card-on-file update request needed."', 'send_reminder', null, getPastTime(14));
  insertAudit.run('aud_6_3', payId6, 'policy_evaluation', 'Policy Engine approved reminder: Blocked retry for expired card, authorized message to request card details update.', 'send_reminder', 'AUTHORIZED', getPastTime(13));
  const expMsg = 'Hi Deepa, your card on file for USD 120 has expired. Please update your payment credentials here to resume service: https://pay.flow/up_6';
  insertAttempt.run('att_6', payId6, 'send_reminder', 'policy_engine', expMsg, 'pending', null, getPastTime(10));
  insertAudit.run('aud_6_4', payId6, 'action_executed', 'Card update link sent to Deepa Nair (+91 97654 32100) via WhatsApp.', 'send_reminder', 'SENT', getPastTime(10));
}

/**
 * Close the database connection and reset the singleton.
 * Used primarily in tests.
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
