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
};
```

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

## Active user metrics

The service reports `user.active.count` at startup and every 15 seconds. It counts
distinct user IDs in the auth table, so multiple sessions for one user count once
and existing sessions are included after a restart. It represents users with stored
login sessions, not users who have recently made a request; a session remains
counted until it is removed (for example, on logout). Collection failures are
logged and retried at the next interval.

For a single service instance, use the gauge displayed by your Grafana data source
(typically `user_active_count`) in a Stat panel.

## Development notes

Install the required packages.

```sh
npm install express jsonwebtoken mysql2 bcrypt
```

Nodemon is assumed to be installed globally so that you can have hot reloading when debugging.

```sh
npm -g install nodemon
```
