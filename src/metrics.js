const os = require('os');
const { randomUUID } = require('crypto');
const config = require('./config.js');

const requestCounts = new Map([
  ['GET', 0n],
  ['PUT', 0n],
  ['POST', 0n],
  ['DELETE', 0n],
]);
const knownMethods = new Set(['GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'CONNECT', 'TRACE']);
const requestDurationBounds = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 10];
const requestDurations = new Map(
  Array.from(requestCounts.keys(), (method) => [method, { count: 0n, sum: 0, buckets: requestDurationBounds.map(() => 0n).concat(0n) }])
);
const instanceId = randomUUID();
const requestCounterStart = (BigInt(Date.now()) * 1_000_000n).toString();
const authenticationCounts = new Map([['success', 0n], ['failure', 0n]]);
let pizzasSold = 0n;

function getCpuUsagePercentage() {
  // Load average is a runnable-work estimate, not direct CPU utilization.
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  // Return the fraction of total system memory that is currently in use.
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

async function sendMetrics(metrics, signal) {
  const { source, endpointUrl, accountId, apiKey } = config.metrics || {};
  if (!source || !endpointUrl || !accountId || !apiKey) {
    throw new Error('Metrics configuration is incomplete');
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: source } }],
          },
          scopeMetrics: [{ scope: { name: source }, metrics }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Metrics endpoint returned HTTP ${response.status}`);
  }
}

function requestTracker(req, res, next) {
  const start = process.hrtime.bigint();
  res.once('finish', () => {
    const method = knownMethods.has(req.method) ? req.method : '_OTHER';
    requestCounts.set(method, (requestCounts.get(method) || 0n) + 1n);
    if (!requestDurations.has(method)) {
      requestDurations.set(method, { count: 0n, sum: 0, buckets: requestDurationBounds.map(() => 0n).concat(0n) });
    }
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const observation = requestDurations.get(method);
    observation.count += 1n;
    observation.sum += duration;
    const bucket = requestDurationBounds.findIndex((bound) => duration <= bound);
    observation.buckets[bucket === -1 ? requestDurationBounds.length : bucket] += 1n;
  });

  next();
}

function recordAuthenticationAttempt(success) {
  if (typeof success !== 'boolean') {
    throw new TypeError('Authentication result must be a boolean');
  }
  const result = success ? 'success' : 'failure';
  authenticationCounts.set(result, authenticationCounts.get(result) + 1n);
}

function startRequestMetricsReporting() {
  let sending = false;

  function report() {
    if (sending) return;
    sending = true;
    const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();

    // Cumulative counters are sampled even during idle periods for Grafana rates.
    sendMetrics([
      {
        name: 'http.server.request.count',
        unit: '{request}',
        sum: {
          aggregationTemporality: 2,
          isMonotonic: true,
          dataPoints: Array.from(requestCounts, ([method, count]) => ({
            asInt: count.toString(),
            attributes: [
              { key: 'http.request.method', value: { stringValue: method } },
              { key: 'service.instance.id', value: { stringValue: instanceId } },
            ],
            startTimeUnixNano: requestCounterStart,
            timeUnixNano,
          })),
        },
      },
      {
        name: 'http.server.request.duration',
        unit: 's',
        histogram: {
          aggregationTemporality: 2,
          dataPoints: Array.from(requestDurations, ([method, duration]) => ({
            count: duration.count.toString(),
            sum: duration.sum,
            bucketCounts: duration.buckets.map((count) => count.toString()),
            explicitBounds: requestDurationBounds,
            attributes: [
              { key: 'http.request.method', value: { stringValue: method } },
              { key: 'service.instance.id', value: { stringValue: instanceId } },
            ],
            startTimeUnixNano: requestCounterStart,
            timeUnixNano,
          })),
        },
      },
      {
        name: 'pizza.sold.count',
        unit: '{pizza}',
        sum: {
          aggregationTemporality: 2,
          isMonotonic: true,
          dataPoints: [{
            asInt: pizzasSold.toString(),
            attributes: [{ key: 'service.instance.id', value: { stringValue: instanceId } }],
            startTimeUnixNano: requestCounterStart,
            timeUnixNano,
          }],
        },
      },
      {
        name: 'auth.attempt.count',
        unit: '{attempt}',
        sum: {
          aggregationTemporality: 2,
          isMonotonic: true,
          dataPoints: Array.from(authenticationCounts, ([result, count]) => ({
            asInt: count.toString(),
            attributes: [
              { key: 'auth.result', value: { stringValue: result } },
              { key: 'service.instance.id', value: { stringValue: instanceId } },
            ],
            startTimeUnixNano: requestCounterStart,
            timeUnixNano,
          })),
        },
      },
    ], AbortSignal.timeout(10_000))
      .catch((error) => {
        console.error('Failed to report request and authentication metrics:', error);
      })
      .finally(() => {
        sending = false;
      });
  }

  report();
  const timer = setInterval(report, 15_000);
  timer.unref();
  return timer;
}

// The caller supplies the number of distinct users with a valid login session.
function reportActiveUsers(count) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Active user count must be a non-negative safe integer');
  }

  const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
  sendMetrics([
    {
      name: 'user.active.count',
      unit: '{user}',
      gauge: {
        dataPoints: [{
          asInt: String(count),
          attributes: [{ key: 'service.instance.id', value: { stringValue: instanceId } }],
          timeUnixNano,
        }],
      },
    },
  ], AbortSignal.timeout(10_000)).catch((error) => {
    console.error('Failed to report active user metrics:', error);
  });
}

function startSystemMetricsReporting() {
  let previousCpus;
  let sending = false;

  function report() {
    if (sending) return;
    const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
    const attributes = [{ key: 'service.instance.id', value: { stringValue: instanceId } }];
    const values = [];

    try {
      const cpus = os.cpus();
      if (cpus.length === 0) throw new Error('No CPU information available');
      if (previousCpus && previousCpus.length === cpus.length) {
        let total = 0;
        let idle = 0;
        let valid = true;
        for (let i = 0; i < cpus.length; i++) {
          for (const key of ['user', 'nice', 'sys', 'idle', 'irq']) {
            const delta = cpus[i].times[key] - previousCpus[i].times[key];
            if (!Number.isFinite(delta) || delta < 0) valid = false;
            total += delta;
            if (key === 'idle') idle += delta;
          }
        }
        if (valid && total > 0) {
          values.push({ name: 'system.cpu.usage.percent', value: ((total - idle) / total) * 100 });
        } else {
          console.error('Failed to collect CPU usage: invalid CPU time interval');
        }
      }
      previousCpus = cpus;
    } catch (error) {
      previousCpus = undefined;
      console.error('Failed to collect CPU usage:', error);
    }

    try {
      const total = os.totalmem();
      const free = os.freemem();
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0 || free > total) {
        throw new Error('Invalid system memory information');
      }
      values.push({ name: 'system.memory.usage.percent', value: ((total - free) / total) * 100 });
    } catch (error) {
      console.error('Failed to collect memory usage:', error);
    }

    if (values.length === 0) return;
    sending = true;
    const metrics = values.map(({ name, value }) => ({
      name,
      unit: '%',
      gauge: { dataPoints: [{ asDouble: value, attributes, timeUnixNano }] },
    }));
    sendMetrics(metrics, AbortSignal.timeout(10_000))
      .catch((error) => {
        console.error('Failed to report system metrics:', error);
      })
      .finally(() => {
        sending = false;
      });
  }

  report();
  const timer = setInterval(report, 15_000);
  timer.unref();
  return timer;
}

function pizzaPurchase(success, latency, price, pizzaCount) {
  if (!Number.isSafeInteger(pizzaCount) || pizzaCount < 0) {
    console.error('Failed to record pizzas sold: pizza count must be a non-negative safe integer');
  } else if (success) {
    pizzasSold += BigInt(pizzaCount);
  }

  const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
  const metrics = [
    {
      name: success ? 'pizza.purchase.count' : 'pizza.purchase.failure.count',
      unit: '{purchase}',
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: [{ asInt: '1', attributes: [], timeUnixNano }],
      },
    },
    {
      name: 'pizza.creation.duration',
      unit: 'ms',
      histogram: {
        aggregationTemporality: 1,
        dataPoints: [
          {
            count: '1',
            sum: latency,
            bucketCounts: ['1'],
            explicitBounds: [],
            attributes: [],
            timeUnixNano,
          },
        ],
      },
    },
  ];

  if (success) {
    metrics.push({
      name: 'pizza.purchase.revenue',
      unit: '1',
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: [{ asDouble: price, attributes: [], timeUnixNano }],
      },
    });
  }

  sendMetrics(metrics).catch((error) => {
    console.error('Failed to report pizza purchase metrics:', error);
  });
}

module.exports = {
  getCpuUsagePercentage,
  getMemoryUsagePercentage,
  requestTracker,
  recordAuthenticationAttempt,
  startRequestMetricsReporting,
  startSystemMetricsReporting,
  reportActiveUsers,
  pizzaPurchase,
};