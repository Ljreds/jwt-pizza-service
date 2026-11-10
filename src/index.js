const app = require('./service.js');
const metrics = require('./metrics.js');
const { DB } = require('./database/database.js');
const { startActiveUserReporting } = require('./activeUserReporter.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  metrics.startRequestMetricsReporting();
  startActiveUserReporting(() => DB.getActiveUserCount(), metrics.reportActiveUsers);
});
