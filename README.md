# 🍕 jwt-pizza-service

![Coverage badge](https://pizza-factory.cs329.click/api/badge/accountId/jwtpizzaservicecoverage)

Backend service for making JWT pizzas. This service tracks users and franchises and orders pizzas. All order requests are passed to the JWT Pizza Factory where the pizzas are made.

JWTs are used for authentication objects.

## Deployment

In order for the server to work correctly it must be configured by providing a `config.js` file.

```js
module.exports =  {
    // Your JWT secret can be any random string you would like. It just needs to be secret.
   jwtSecret: 'yourjwtsecrethere',
   db: {
   connection: {
      host: '127.0.0.1',
      user: 'root',
      password: 'yourpasswordhere',
      database: 'pizza',
      connectTimeout: 60000,
   },
   listPerPage: 10,
   },
   factory: {
   url: 'https://pizza-factory.cs329.click',
   apiKey: 'yourapikeyhere',
   },
   metrics: {
     source: 'jwt-pizza-service-dev',
     endpointUrl: 'https://your-grafana-otlp-endpoint/otlp/v1/metrics',
     accountId: 'your-grafana-account-id',
     apiKey: 'your-grafana-api-key',
   },
};
```

For production deployments, configure the GitHub Actions secrets
`METRICS_ENDPOINT_URL`, `METRICS_ACCOUNT_ID`, and `METRICS_API_KEY`. The CI
workflow uses `jwt-pizza-service` as the production metrics source, distinct
from the development source. The generated config is included in the deployment
artifact and image, so access to those artifacts should be restricted.

## Endpoints

You can get the documentation for all endpoints by making the following request.

```sh
curl localhost:3000/api/docs
```

## HTTP request metrics

The service sends cumulative HTTP request counts to the configured Grafana OTLP
endpoint every 15 seconds, including when traffic is idle. Counts are recorded
when responses finish, grouped by method and service instance. Unknown HTTP
methods are grouped as `_OTHER`. Reporting is best-effort and does not block requests.

In Grafana's Prometheus data source, use these PromQL queries for requests per
minute (select the metric name shown by your data source if its translation differs):

```promql
sum by (http_request_method) (increase(http_server_request_count_total[1m]))
```

```promql
sum(increase(http_server_request_count_total[1m]))
```

The first query provides a series for each method; the second provides the total.
`increase` estimates the count over a rolling minute, so values can be fractional.

Request duration is recorded from middleware entry until the response finishes,
and exported as the cumulative `http.server.request.duration` histogram in
seconds. For average latency in milliseconds by method over one minute:

```promql
1000 * sum by (http_request_method) (rate(http_server_request_duration_seconds_sum[1m]))
  / sum by (http_request_method) (rate(http_server_request_duration_seconds_count[1m]))
```

Use the metric names shown by your Grafana data source if its translation differs.
This groups by method, not by endpoint; aborted responses are not recorded.

## Active user metrics

The service reports `user.active.count` at startup and every 15 seconds. It counts
distinct user IDs in the auth table, so multiple sessions for one user count once
and existing sessions are included after a restart. It represents users with stored
login sessions, not users who have recently made a request; a session remains
counted until it is removed (for example, on logout). Collection failures are
logged and retried at the next interval.

For a single service instance, use the gauge displayed by your Grafana data source
(typically `user_active_count`) in a Stat panel.

## Authentication attempt metrics

`recordAuthenticationAttempt(success)` records a successful (`true`) or failed
(`false`) attempt. The service exports cumulative `auth.attempt.count` values
every 15 seconds, including idle periods. Attempts are recorded for the login
endpoint (`PUT /api/auth`): success means a session was created, while failure
includes rejected credentials and errors creating the session. Registration,
logout, and token checks are not counted.

Use this PromQL query to display attempts per minute by outcome:

```promql
sum by (auth_result) (increase(auth_attempt_count_total[1m]))
```

Check the metric and label names in your Grafana data source if its translation
differs. Values are estimates over a rolling minute and can be fractional.

## Pizzas sold

The service counts each item in a successful factory order as one pizza. Failed
orders do not increase the sold count. `pizza.sold.count` is exported as a
cumulative counter every 15 seconds, including idle periods. For pizzas sold
per minute, use a query such as:

```promql
sum(increase(pizza_sold_count_total[1m]))
```

Select the translated metric name shown by your data source if it differs.
`increase` estimates the count over a rolling minute and can be fractional.

## System metrics

The service sends `system.memory.usage.percent` and `system.cpu.usage.percent`
as gauges every 15 seconds. Memory is the operating system's used memory
percentage (`total - free`); CPU is the percentage of non-idle CPU time across
logical cores during the preceding sampling interval. Memory is reported at
startup; CPU needs two samples, so its first value arrives after 15 seconds.
These are system-wide values, not the Node.js process's usage, and may reflect
host rather than container limits. In Grafana, select the translated metric
names from the data source and set gauge panels to a 0–100 percent scale.

## Development notes

Install the required packages.

```sh
npm install express jsonwebtoken mysql2 bcrypt
```

Nodemon is assumed to be installed globally so that you can have hot reloading when debugging.

```sh
npm -g install nodemon
```
