const express = require('express');
const request = require('supertest');

jest.mock('../config.js', () => ({
  factory: { url: 'https://factory.example.test', apiKey: 'test-key' },
}));
jest.mock('../database/database.js', () => ({
  DB: { addDinerOrder: jest.fn() },
  Role: {},
}));
jest.mock('./authRouter.js', () => ({
  authRouter: {
    authenticateToken: (req, res, next) => {
      req.user = { id: 1, name: 'Test user', email: 'test@example.test' };
      next();
    },
  },
}));
jest.mock('../metrics.js', () => ({ pizzaPurchase: jest.fn() }));

const { DB } = require('../database/database.js');
const metrics = require('../metrics.js');
const orderRouter = require('./orderRouter.js');

const app = express();
app.use(express.json());
app.use('/api/order', orderRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ message: err.message });
});

const order = {
  id: 1,
  franchiseId: 1,
  storeId: 1,
  items: [{ price: '2.50' }, { price: 3 }],
};
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  DB.addDinerOrder.mockResolvedValue(order);
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

test('reports the total price and factory latency for a successful order', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ reportUrl: 'report', jwt: 'token' }),
  });

  const response = await request(app).post('/api/order').send(order);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ order, followLinkToEndChaos: 'report', jwt: 'token' });
  expect(metrics.pizzaPurchase).toHaveBeenCalledTimes(1);
  expect(metrics.pizzaPurchase).toHaveBeenCalledWith(true, expect.any(Number), 5.5);
  expect(metrics.pizzaPurchase.mock.calls[0][1]).toBeGreaterThanOrEqual(0);
});

test('reports a failed factory response without revenue', async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    json: async () => ({ reportUrl: 'report' }),
  });

  const response = await request(app).post('/api/order').send(order);

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: 'report' });
  expect(metrics.pizzaPurchase).toHaveBeenCalledTimes(1);
  expect(metrics.pizzaPurchase).toHaveBeenCalledWith(false, expect.any(Number), 0);
});

test('reports a failed factory connection and propagates the error', async () => {
  global.fetch.mockRejectedValue(new Error('Factory unavailable'));

  const response = await request(app).post('/api/order').send(order);

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ message: 'Factory unavailable' });
  expect(metrics.pizzaPurchase).toHaveBeenCalledTimes(1);
  expect(metrics.pizzaPurchase).toHaveBeenCalledWith(false, expect.any(Number), 0);
});

test('does not report a factory attempt if saving the order fails', async () => {
  DB.addDinerOrder.mockRejectedValue(new Error('Database unavailable'));

  const response = await request(app).post('/api/order').send(order);

  expect(response.status).toBe(500);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(metrics.pizzaPurchase).not.toHaveBeenCalled();
});
