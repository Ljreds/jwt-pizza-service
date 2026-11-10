const os = require('os');
const config = require('./config.js');

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

async function sendMetrics(metrics) {
  const { source, endpointUrl, accountId, apiKey } = config.metrics || {};
  if (!source || !endpointUrl || !accountId || !apiKey) {
    throw new Error('Metrics configuration is incomplete');
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
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
    const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();

    // Grafana can group this counter by method or sum methods for the total.
    sendMetrics([
      {
        name: 'http.server.request.count',
        unit: '{request}',
        sum: {
          aggregationTemporality: 1,
          isMonotonic: true,
          dataPoints: [
            {
              asInt: '1',
              attributes: [{ key: 'http.request.method', value: { stringValue: req.method } }],
              timeUnixNano,
            },
          ],
        },
      },
    ]).catch((error) => {
      console.error('Failed to report request metrics:', error);
    });
  });

  next();
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
  pizzaPurchase,
};