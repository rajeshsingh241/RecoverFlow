const request = require('supertest');
const app = require('../src/index');
const { getDb, closeDb } = require('../src/db');

// Use in-memory database for tests
beforeAll(() => {
  // Force a fresh in-memory DB for tests
  closeDb();
  getDb(':memory:');
});

afterAll(() => {
  closeDb();
});

describe('POST /expenses', () => {
  it('should create a new expense and return 201', async () => {
    const res = await request(app)
      .post('/expenses')
      .send({
        amount: 250.50,
        currency: 'INR',
        category: 'Food & Dining',
        description: 'Lunch at cafe',
        date: '2025-04-28',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.amount).toBe('250.50');
    expect(res.body.data.currency).toBe('INR');
    expect(res.body.data.category).toBe('Food & Dining');
    expect(res.body.data.id).toBeDefined();
  });

  it('should reject negative amounts', async () => {
    const res = await request(app)
      .post('/expenses')
      .send({
        amount: -50,
        currency: 'INR',
        category: 'Food & Dining',
        date: '2025-04-28',
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'amount' }),
      ])
    );
  });

  it('should reject invalid category', async () => {
    const res = await request(app)
      .post('/expenses')
      .send({
        amount: 100,
        category: 'InvalidCategory',
        date: '2025-04-28',
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'category' }),
      ])
    );
  });

  it('should reject missing date', async () => {
    const res = await request(app)
      .post('/expenses')
      .send({
        amount: 100,
        category: 'Food & Dining',
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date' }),
      ])
    );
  });

  it('should handle idempotency key — duplicate request returns same response', async () => {
    const idempotencyKey = 'test-idem-key-001';

    const res1 = await request(app)
      .post('/expenses')
      .set('X-Idempotency-Key', idempotencyKey)
      .send({
        amount: 100,
        currency: 'USD',
        category: 'Transport',
        description: 'Taxi ride',
        date: '2025-04-28',
      });

    expect(res1.status).toBe(201);
    const expenseId = res1.body.data.id;

    // Same idempotency key — should return the cached response
    const res2 = await request(app)
      .post('/expenses')
      .set('X-Idempotency-Key', idempotencyKey)
      .send({
        amount: 999,
        category: 'Shopping',
        description: 'Different data entirely',
        date: '2025-04-29',
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(expenseId);
    expect(res2.body.data.amount).toBe(res1.body.data.amount);
  });

  it('should support JPY with zero decimal places', async () => {
    const res = await request(app)
      .post('/expenses')
      .send({
        amount: 1500,
        currency: 'JPY',
        category: 'Food & Dining',
        description: 'Ramen',
        date: '2025-04-28',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe('1500');
    expect(res.body.data.currency).toBe('JPY');
  });
});

describe('GET /expenses', () => {
  beforeAll(async () => {
    // Seed some expenses
    const expenses = [
      { amount: 500, currency: 'INR', category: 'Groceries', description: 'Weekly groceries', date: '2025-04-25' },
      { amount: 1200, currency: 'INR', category: 'Transport', description: 'Metro pass', date: '2025-04-20' },
      { amount: 300, currency: 'INR', category: 'Groceries', description: 'Fruits', date: '2025-04-27' },
    ];

    for (const exp of expenses) {
      await request(app).post('/expenses').send(exp);
    }
  });

  it('should return all expenses', async () => {
    const res = await request(app).get('/expenses');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.totals).toBeDefined();
  });

  it('should filter by category', async () => {
    const res = await request(app).get('/expenses?category=Groceries');

    expect(res.status).toBe(200);
    res.body.data.forEach((exp) => {
      expect(exp.category).toBe('Groceries');
    });
  });

  it('should sort by date descending by default', async () => {
    const res = await request(app).get('/expenses');

    expect(res.status).toBe(200);
    const dates = res.body.data.map((e) => e.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] <= dates[i - 1]).toBe(true);
    }
  });

  it('should sort by date ascending when requested', async () => {
    const res = await request(app).get('/expenses?sort=date_asc');

    expect(res.status).toBe(200);
    const dates = res.body.data.map((e) => e.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });

  it('should return correct total per currency', async () => {
    const res = await request(app).get('/expenses');

    expect(res.status).toBe(200);
    const inrTotal = res.body.meta.totals.find((t) => t.currency === 'INR');
    expect(inrTotal).toBeDefined();
    expect(Number(inrTotal.total)).toBeGreaterThan(0);
  });
});

describe('GET /expenses/categories', () => {
  it('should return the list of valid categories', async () => {
    const res = await request(app).get('/expenses/categories');

    expect(res.status).toBe(200);
    expect(res.body.data).toContain('Food & Dining');
    expect(res.body.data).toContain('Other');
  });
});

describe('GET /health', () => {
  it('should return ok status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
