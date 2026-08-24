const request = require('supertest');
const app = require('../src/index');
const { getDb, closeDb } = require('../src/db');
const { evaluatePolicy } = require('../src/services/policyEngine');

beforeAll(() => {
  closeDb();
  getDb(':memory:'); // Force separate test db
});

afterAll(() => {
  closeDb();
});

describe('Policy Engine Rules', () => {
  it('should flag transactions >= 50,000 INR equivalent for manager approval', () => {
    const payment = { amount_minor: 5000000, currency: 'INR', attempt_count: 1, failure_reason_code: 'bank_timeout' };
    const customer = { payment_history_summary: 'high_success_rate' };
    const result = evaluatePolicy(payment, customer, 'retry');
    
    expect(result.requiresApproval).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('safety threshold');
  });

  it('should override retry to alternative_payment_method when max attempts reached', () => {
    const payment = { amount_minor: 100000, currency: 'INR', attempt_count: 3, failure_reason_code: 'bank_timeout' };
    const customer = { payment_history_summary: 'high_success_rate' };
    const result = evaluatePolicy(payment, customer, 'retry');

    expect(result.action).toBe('alternative_payment_method');
    expect(result.authorized).toBe(true);
    expect(result.reason).toContain('Max auto-retry attempts (3) reached');
  });

  it('should override retry to send_reminder for hard decline error code insufficient_funds', () => {
    const payment = { amount_minor: 100000, currency: 'INR', attempt_count: 1, failure_reason_code: 'insufficient_funds' };
    const customer = { payment_history_summary: 'high_success_rate' };
    const result = evaluatePolicy(payment, customer, 'retry');

    expect(result.action).toBe('send_reminder');
    expect(result.authorized).toBe(true);
    expect(result.reason).toContain('Automatic retry is blocked for hard failure');
  });
});

describe('API Endpoints /api/payments', () => {
  let simulatedPaymentId;

  it('should fetch the list of payments and calculate stats', async () => {
    const res = await request(app).get('/api/payments');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.stats.total_revenue).toBeGreaterThan(0);
    expect(res.body.meta.stats.recovery_rate).toBeDefined();
  });

  it('should simulate a payment failure, run policies, and auto-execute when authorized', async () => {
    const res = await request(app)
      .post('/api/payments/simulate')
      .send({
        customer_id: 'cust_1',
        amount: 250,
        currency: 'INR',
        failure_reason_code: 'insufficient_funds'
      });

    expect(res.status).toBe(201);
    expect(res.body.payment).toBeDefined();
    simulatedPaymentId = res.body.payment.id;
    
    // For insufficient_funds, policy engine should authorize reminder sending
    expect(res.body.policy.authorized).toBe(true);
    expect(res.body.policy.requiresApproval).toBe(false);
  });

  it('should fetch details and audit logs for a payment', async () => {
    expect(simulatedPaymentId).toBeDefined();
    const res = await request(app).get(`/api/payments/${simulatedPaymentId}/audit`);
    
    expect(res.status).toBe(200);
    expect(res.body.payment).toBeDefined();
    expect(res.body.audit_logs.length).toBeGreaterThan(0);
  });

  it('should simulate a customer link checkout successfully', async () => {
    expect(simulatedPaymentId).toBeDefined();
    const res = await request(app)
      .post(`/api/payments/${simulatedPaymentId}/simulate-checkout`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('recovered');
  });
});
