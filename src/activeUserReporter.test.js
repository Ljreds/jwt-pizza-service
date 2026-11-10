const { startActiveUserReporting } = require('./activeUserReporter.js');

test('reports the current distinct user count at startup and every 15 seconds', async () => {
  jest.useFakeTimers();
  const getCount = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  const report = jest.fn();
  const timer = startActiveUserReporting(getCount, report);
  try {
    await jest.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenNthCalledWith(1, 2);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(report).toHaveBeenNthCalledWith(2, 1);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(report).toHaveBeenNthCalledWith(3, 0);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
});

test('logs database failures without reporting a false count and retries', async () => {
  jest.useFakeTimers();
  const getCount = jest.fn().mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValueOnce(3);
  const report = jest.fn();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const timer = startActiveUserReporting(getCount, report);
  try {
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('Failed to collect active user metrics:', expect.any(Error));
    expect(report).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(report).toHaveBeenCalledWith(3);
  } finally {
    clearInterval(timer);
    log.mockRestore();
    jest.useRealTimers();
  }
});

test('does not overlap database collections', async () => {
  jest.useFakeTimers();
  let resolveCount;
  const getCount = jest.fn().mockImplementationOnce(() => new Promise((resolve) => {
    resolveCount = resolve;
  })).mockResolvedValue(1);
  const report = jest.fn();
  const timer = startActiveUserReporting(getCount, report);
  try {
    await jest.advanceTimersByTimeAsync(30_000);
    expect(getCount).toHaveBeenCalledTimes(1);
    resolveCount(2);
    await jest.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith(2);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(report).toHaveBeenLastCalledWith(1);
  } finally {
    clearInterval(timer);
    jest.useRealTimers();
  }
});
