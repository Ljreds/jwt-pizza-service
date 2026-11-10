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
const instanceId = randomUUID();
const requestCounterStart = (BigInt(Date.now()) * 1_000_000n).toString();
const authenticationCounts = new Map([['success', 0n], ['failure', 0n]]);

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
  res.once('finish', () => {
    const method = knownMethods.has(req.method) ? req.method : '_OTHER';
    requestCounts.set(method, (requestCounts.get(method) || 0n) + 1n);
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

function pizzaPurchase(success, latency, price) {
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
  reportActiveUsers,
  pizzaPurchase,
};