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

test('reports cumulative request latency in seconds by HTTP method', async () => {
  jest.useFakeTimers();
  jest.resetModules();
  const isolatedMetrics = require('./metrics.js');
  const timer = isolatedMetrics.startRequestMetricsReporting();
  try {
    const getPoints = (call) => {
      const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[call][1].body);
      const histogram = resourceMetrics[0].scopeMetrics[0].metrics.find((metric) => metric.name === 'http.server.request.duration');
      expect(histogram.unit).toBe('s');
      expect(histogram.histogram.aggregationTemporality).toBe(2);
      return histogram.histogram.dataPoints;
    };
    const initial = getPoints(0);
    expect(initial.find((point) => point.attributes[0].value.stringValue === 'GET').count).toBe('0');
    const getResponse = new EventEmitter();
    const postResponse = new EventEmitter();
    isolatedMetrics.requestTracker({ method: 'GET' }, getResponse, jest.fn());
    await jest.advanceTimersByTimeAsync(50);
    getResponse.emit('finish');
    isolatedMetrics.requestTracker({ method: 'POST' }, postResponse, jest.fn());
    await jest.advanceTimersByTimeAsync(200);
    postResponse.emit('finish');
    getResponse.emit('finish');
    await jest.advanceTimersByTimeAsync(14_750);

    const reported = getPoints(1);
    const get = reported.find((point) => point.attributes[0].value.stringValue === 'GET');
    const post = reported.find((point) => point.attributes[0].value.stringValue === 'POST');
    expect(get.count).toBe('1');
    expect(get.sum).toBeCloseTo(0.05);
    expect(get.bucketCounts[get.explicitBounds.indexOf(0.05)]).toBe('1');
    expect(post.count).toBe('1');
    expect(post.sum).toBeCloseTo(0.2);
    expect(post.bucketCounts[post.explicitBounds.indexOf(0.25)]).toBe('1');
    expect(get.startTimeUnixNano).toBe(initial[0].startTimeUnixNano);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(getPoints(2).find((point) => point.attributes[0].value.stringValue === 'GET').sum).toBeCloseTo(0.05);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
});

test('records authentication successes and failures as cumulative counters', async () => {
  jest.useFakeTimers();
  const timer = metrics.startRequestMetricsReporting();
  try {
    const points = (call) => {
      const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[call][1].body);
      const metric = resourceMetrics[0].scopeMetrics[0].metrics.find((item) => item.name === 'auth.attempt.count');
      expect(metric.unit).toBe('{attempt}');
      expect(metric.sum.aggregationTemporality).toBe(2);
      expect(metric.sum.isMonotonic).toBe(true);
      return metric.sum.dataPoints;
    };
    const initial = points(0);
    expect(initial.map((point) => point.asInt)).toEqual(['0', '0']);
    metrics.recordAuthenticationAttempt(true);
    metrics.recordAuthenticationAttempt(true);
    metrics.recordAuthenticationAttempt(false);
    await jest.advanceTimersByTimeAsync(15_000);
    const reported = points(1);
    expect(reported.map((point) => [point.attributes[0].value.stringValue, point.asInt])).toEqual([
      ['success', '2'], ['failure', '1'],
    ]);
    expect(reported[0].startTimeUnixNano).toBe(initial[0].startTimeUnixNano);
    expect(reported[0].attributes[1]).toEqual(initial[0].attributes[1]);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(points(2).map((point) => point.asInt)).toEqual(['2', '1']);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
});

test.each([undefined, null, 'false', 0])('rejects invalid authentication result %s', (result) => {
  expect(() => metrics.recordAuthenticationAttempt(result)).toThrow('Authentication result must be a boolean');
});

test.each([0, 3])('reports %i active users as a gauge', (count) => {
  metrics.reportActiveUsers(count);

  const { resourceMetrics } = JSON.parse(global.fetch.mock.calls[0][1].body);
  const metric = resourceMetrics[0].scopeMetrics[0].metrics[0];
  expect(metric.name).toBe('user.active.count');
  expect(metric.unit).toBe('{user}');
  expect(metric.gauge.dataPoints).toEqual([
    expect.objectContaining({
      asInt: String(count),
      attributes: [{ key: 'service.instance.id', value: { stringValue: expect.any(String) } }],
      timeUnixNano: expect.any(String),
    }),
  ]);
});

test.each([-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid active user count %s', (count) => {
  expect(() => metrics.reportActiveUsers(count)).toThrow('Active user count must be a non-negative safe integer');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('logs active user metric delivery failures', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 503 });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    metrics.reportActiveUsers(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(log).toHaveBeenCalledWith('Failed to report active user metrics:', expect.any(Error));
  } finally {
    log.mockRestore();
  }
});

test('reports memory immediately and CPU usage over sampling intervals', async () => {
  jest.useFakeTimers();
  const cpu = (user, idle) => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
  os.cpus.mockReset().mockReturnValueOnce(cpu(100, 100)).mockReturnValueOnce(cpu(150, 150)).mockReturnValueOnce(cpu(175, 225));
  os.totalmem.mockReturnValue(100);
  os.freemem.mockReturnValue(25);
  const timer = metrics.startSystemMetricsReporting();
  try {
    const reported = (call) => JSON.parse(global.fetch.mock.calls[call][1].body).resourceMetrics[0].scopeMetrics[0].metrics;
    expect(reported(0).map((metric) => metric.name)).toEqual(['system.memory.usage.percent']);
    expect(reported(0)[0].gauge.dataPoints[0].asDouble).toBe(75);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(reported(1).map((metric) => [metric.name, metric.unit, metric.gauge.dataPoints[0].asDouble])).toEqual([
      ['system.cpu.usage.percent', '%', 50],
      ['system.memory.usage.percent', '%', 75],
    ]);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(reported(2)[0].gauge.dataPoints[0].asDouble).toBe(25);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
});

test('skips invalid CPU samples and logs failed system metric delivery', async () => {
  jest.useFakeTimers();
  const cpu = [{ times: { user: 100, nice: 0, sys: 0, idle: 100, irq: 0 } }];
  os.cpus.mockReset().mockReturnValue(cpu);
  os.totalmem.mockReturnValue(100);
  os.freemem.mockReturnValue(25);
  global.fetch.mockResolvedValue({ ok: false, status: 503 });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const timer = metrics.startSystemMetricsReporting();
  try {
    await jest.advanceTimersByTimeAsync(15_000);
    expect(log).toHaveBeenCalledWith('Failed to report system metrics:', expect.any(Error));
    expect(log).toHaveBeenCalledWith('Failed to collect CPU usage: invalid CPU time interval');
    const sent = JSON.parse(global.fetch.mock.calls[1][1].body).resourceMetrics[0].scopeMetrics[0].metrics;
    expect(sent.map((metric) => metric.name)).toEqual(['system.memory.usage.percent']);
  } finally {
    clearInterval(timer);
    log.mockRestore();
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
