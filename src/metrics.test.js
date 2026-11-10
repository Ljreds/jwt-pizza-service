jest.mock('os', () => ({
  loadavg: jest.fn(),
  cpus: jest.fn(),
  totalmem: jest.fn(),
  freemem: jest.fn(),
}));

jest.mock('./config.js', () => ({
  metrics: {
    source: 'test-service',
    endpointUrl: 'https://metrics.example.test/v1/metrics',
    accountId: 'test-account',
    apiKey: 'test-key',
  },
}));

const { EventEmitter } = require('events');
const os = require('os');
const metrics = require('./metrics.js');

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

test('estimates CPU load percentage relative to logical CPU count', () => {
  os.loadavg.mockReturnValue([0.5]);
  os.cpus.mockReturnValue([{}, {}, {}, {}]);

  expect(metrics.getCpuUsagePercentage()).toBe(13);
});

test('calculates memory usage percentage', () => {
  os.totalmem.mockReturnValue(8);
  os.freemem.mockReturnValue(2);

  expect(metrics.getMemoryUsagePercentage()).toBe('75.00');
});

test('reports request counts with the HTTP method as an attribute', () => {
  const req = { method: 'GET' };
  const res = new EventEmitter();
  res.statusCode = 200;
  const next = jest.fn();

  metrics.requestTracker(req, res, next);
  expect(next).toHaveBeenCalled();

  res.emit('finish');

  const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[0][1].body);
  const requestMetric = resourceMetrics[0].scopeMetrics[0].metrics[0];
  expect(requestMetric.name).toBe('http.server.request.count');
  expect(requestMetric.sum.dataPoints[0]).toEqual(
    expect.objectContaining({
      asInt: '1',
      attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }],
    })
  );
});

test('reports successful purchases, revenue, and pizza creation latency', () => {
  metrics.pizzaPurchase(true, 25, 10);

  const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[0][1].body);
  const purchaseMetrics = resourceMetrics[0].scopeMetrics[0].metrics;
  expect(purchaseMetrics.map((metric) => metric.name)).toEqual([
    'pizza.purchase.count',
    'pizza.creation.duration',
    'pizza.purchase.revenue',
  ]);
  expect(purchaseMetrics[0].sum.dataPoints[0].asInt).toBe('1');
  expect(purchaseMetrics[1].histogram.dataPoints[0].sum).toBe(25);
  expect(purchaseMetrics[2].sum.dataPoints[0].asDouble).toBe(10);
});

test('reports failed pizza purchases without reporting price', () => {
  metrics.pizzaPurchase(false, 40, 0);

  const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[0][1].body);
  const purchaseMetrics = resourceMetrics[0].scopeMetrics[0].metrics;
  expect(purchaseMetrics.map((metric) => metric.name)).toEqual([
    'pizza.purchase.failure.count',
    'pizza.creation.duration',
  ]);
  expect(purchaseMetrics[0].sum.dataPoints[0].asInt).toBe('1');
  expect(purchaseMetrics[1].histogram.dataPoints[0].sum).toBe(40);
});
