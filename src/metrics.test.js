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

test('reports cumulative request counts by method, including idle intervals', async () => {
  jest.useFakeTimers();
  const timer = metrics.startRequestMetricsReporting();
  try {
    const points = (call) => {
      const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[call][1].body);
      const metric = resourceMetrics[0].scopeMetrics[0].metrics[0];
      expect(metric.name).toBe('http.server.request.count');
      expect(metric.sum.aggregationTemporality).toBe(2);
      expect(metric.sum.isMonotonic).toBe(true);
      return metric.sum.dataPoints;
    };
    const initial = points(0);
    expect(initial.map((point) => point.asInt)).toEqual(['0', '0', '0', '0']);

    for (const method of ['GET', 'GET', 'POST', 'PUT', 'DELETE', 'CUSTOM']) {
      const res = new EventEmitter();
      const next = jest.fn();
      metrics.requestTracker({ method }, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      res.emit('finish');
      res.emit('finish');
    }
    await jest.advanceTimersByTimeAsync(15_000);
    const reported = points(1);
    expect(reported.map((point) => [point.attributes[0].value.stringValue, point.asInt])).toEqual([
      ['GET', '2'], ['PUT', '1'], ['POST', '1'], ['DELETE', '1'], ['_OTHER', '1'],
    ]);
    expect(reported[0].attributes[1]).toEqual(initial[0].attributes[1]);
    expect(reported[0].startTimeUnixNano).toBe(initial[0].startTimeUnixNano);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(points(2).map((point) => point.asInt)).toEqual(['2', '1', '1', '1', '1']);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
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
