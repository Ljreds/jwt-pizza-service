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

## Development notes

Install the required packages.

```sh
npm install express jsonwebtoken mysql2 bcrypt
```

Nodemon is assumed to be installed globally so that you can have hot reloading when debugging.

```sh
npm -g install nodemon
```
