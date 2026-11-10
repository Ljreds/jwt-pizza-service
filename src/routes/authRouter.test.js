const express = require('express');
const request = require('supertest');

jest.mock('../config.js', () => ({
  jwtSecret: 'test-secret',
  metrics: {
    source: 'test-service',
    endpointUrl: 'https://metrics.example.test/v1/metrics',
    accountId: 'test-account',
    apiKey: 'test-key',
  },
}));
jest.mock('../database/database.js', () => ({
  DB: {
    getUser: jest.fn(),
    loginUser: jest.fn(),
  },
  Role: { Diner: 'diner' },
}));

const { DB } = require('../database/database.js');
const metrics = require('../metrics.js');
const { authRouter } = require('./authRouter.js');
const { StatusCodeError } = require('../endpointHelper.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.statusCode ?? 500).json({ message: err.message });
});

const user = { id: 1, name: 'Diner', roles: [] };
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  DB.getUser.mockResolvedValue(user);
  DB.loginUser.mockResolvedValue();
});

afterAll(() => {
  global.fetch = originalFetch;
});

test('records login outcomes and exports cumulative success and failure counts', async () => {
  const record = jest.spyOn(metrics, 'recordAuthenticationAttempt');
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  let timer;
  try {
    const success = await request(app).put('/api/auth').send({ email: 'diner@example.test', password: 'valid' });
    expect(success.status).toBe(200);
    expect(success.body.user).toEqual(user);
    expect(success.body.token).toEqual(expect.any(String));
    expect(record).toHaveBeenLastCalledWith(true);

    DB.getUser.mockRejectedValueOnce(new StatusCodeError('unknown user', 404));
    const rejected = await request(app).put('/api/auth').send({ email: 'diner@example.test', password: 'invalid' });
    expect(rejected.status).toBe(404);
    expect(rejected.body.message).toBe('unknown user');
    expect(record).toHaveBeenLastCalledWith(false);

    DB.loginUser.mockRejectedValueOnce(new Error('Database unavailable'));
    const failed = await request(app).put('/api/auth').send({ email: 'diner@example.test', password: 'valid' });
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('Database unavailable');
    expect(record).toHaveBeenLastCalledWith(false);
    expect(record).toHaveBeenCalledTimes(3);

    timer = metrics.startRequestMetricsReporting();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const reported = body.resourceMetrics[0].scopeMetrics[0].metrics.find((metric) => metric.name === 'auth.attempt.count');
    expect(reported.sum.dataPoints.map((point) => [point.attributes[0].value.stringValue, point.asInt])).toEqual([
      ['success', '1'], ['failure', '2'],
    ]);
  } finally {
    if (timer) clearInterval(timer);
    record.mockRestore();
  }
});
