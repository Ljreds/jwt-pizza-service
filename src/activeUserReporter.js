function startActiveUserReporting(getActiveUserCount, reportActiveUsers) {
  let collecting = false;

  async function report() {
    if (collecting) return;
    collecting = true;
    try {
      const count = await getActiveUserCount();
      reportActiveUsers(count);
    } catch (error) {
      console.error('Failed to collect active user metrics:', error);
    } finally {
      collecting = false;
    }
  }

  void report();
  const timer = setInterval(report, 15_000);
  timer.unref();
  return timer;
}

module.exports = { startActiveUserReporting };
