#!/bin/sh

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 http://localhost:3000" >&2
  exit 1
fi

case "$1" in
  http://*|https://*) host=${1%/} ;;
  *) echo "Host must start with http:// or https://" >&2; exit 1 ;;
esac

for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

diner_email=${DINER_EMAIL:-d@jwt.com}
diner_password=${DINER_PASSWORD:-diner}
session_email=${SESSION_EMAIL:-f@jwt.com}
session_password=${SESSION_PASSWORD:-franchisee}
failure_email=${FAILURE_EMAIL:-$diner_email}
failure_password=${FAILURE_PASSWORD:-$diner_password}

login() {
  credentials=$(jq -n --arg email "$1" --arg password "$2" '{email: $email, password: $password}') || return 1
  response=$(curl -fsS --max-time 10 -X PUT "$host/api/auth" \
    -H 'Content-Type: application/json' --data "$credentials") || {
    echo "Login request failed for $1" >&2
    return 1
  }
  printf '%s' "$response" | jq -er '.token | select(type == "string" and length > 0)' || {
    echo "Login response did not contain a token for $1" >&2
    return 1
  }
}

logout() {
  if ! curl -fsS --max-time 10 -o /dev/null -X DELETE "$host/api/auth" \
    -H "Authorization: Bearer $1"; then
    echo "Logout request failed" >&2
  fi
}

pause() {
  sleep "$1" &
  sleep_pid=$!
  wait "$sleep_pid"
  sleep_pid=
}

worker_cleanup() {
  trap '' INT TERM
  if [ -n "${sleep_pid:-}" ]; then
    kill "$sleep_pid" 2>/dev/null || :
    wait "$sleep_pid" 2>/dev/null || :
  fi
  if [ -n "${token:-}" ]; then
    logout "$token"
    token=
  fi
}

setup_worker() {
  token=
  sleep_pid=
  trap 'exit 0' INT TERM
  trap worker_cleanup 0
}

browse_menu() {
  setup_worker
  while :; do
    if ! curl -fsS --max-time 10 -o /dev/null "$host/api/order/menu"; then
      echo "Menu request failed" >&2
    fi
    pause 3
  done
}

invalid_login() {
  setup_worker
  while :; do
    status=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
      -X PUT "$host/api/auth" -H 'Content-Type: application/json' \
      --data '{"email":"unknown@jwt.com","password":"bad"}') || status=000
    case "$status" in
      4??) echo "Invalid login rejected (HTTP $status)" ;;
      *) echo "Unexpected invalid login result (HTTP $status)" >&2 ;;
    esac
    pause 25
  done
}

user_session() {
  setup_worker
  while :; do
    if token=$(login "$session_email" "$session_password"); then
      echo "Session started"
      pause 110
      logout "$token"
      token=
      pause 10
    else
      token=
      pause 30
    fi
  done
}

order_loop() {
  setup_worker
  email=$1
  password=$2
  count=$3
  hold=$4
  interval=$5
  payload=$(jq -n --argjson count "$count" \
    '{franchiseId: 1, storeId: 1, items: [range(0; $count) | {menuId: 1, description: "Veggie", price: 0.05}]}') || exit 1

  while :; do
    if token=$(login "$email" "$password"); then
      status=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' \
        -X POST "$host/api/order" -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" --data "$payload") || status=000
      if [ "$count" -eq 1 ]; then
        case "$status" in
          2??) echo "Pizza order succeeded (HTTP $status)" ;;
          *) echo "Pizza order failed (HTTP $status)" >&2 ;;
        esac
      else
        case "$status" in
          2??|000) echo "Oversized order did not fail as expected (HTTP $status)" >&2 ;;
          *) echo "Oversized order rejected (HTTP $status)" ;;
        esac
      fi
      pause "$hold"
      logout "$token"
      token=
      pause "$interval"
    else
      token=
      pause 30
    fi
  done
}

cleanup() {
  trap '' INT TERM
  for pid in $workers; do
    kill "$pid" 2>/dev/null || :
  done
  for pid in $workers; do
    wait "$pid" 2>/dev/null || :
  done
  echo "Traffic generation stopped"
}

workers=
trap 'exit 0' INT TERM
trap cleanup 0

echo "Generating traffic against $host. Press Ctrl-C to stop."
browse_menu & workers="$workers $!"
invalid_login & workers="$workers $!"
user_session & workers="$workers $!"
order_loop "$diner_email" "$diner_password" 1 20 30 & workers="$workers $!"
order_loop "$failure_email" "$failure_password" 22 5 295 & workers="$workers $!"
wait
