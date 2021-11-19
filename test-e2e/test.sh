#!/usr/bin/env bash

set -e

trap cleanup EXIT

FILE=docker-compose.test.yml

cleanup() {
  [[ ! -z "$http_server_pid" ]] && kill $http_server_pid
  docker-compose -f $FILE rm -s -f relayer1
  docker-compose -f $FILE rm -s -f relayer2
  docker-compose -f $FILE down -v
}
cleanup

echo "Starting our own ganache instance"
docker-compose -f $FILE up ganache &
sleep 5
echo "Deploy ZP contracts"
docker-compose -f $FILE up contracts

echo "Staring redis1..."
docker-compose -f $FILE up redis1 &

echo "Staring redis2..."
docker-compose -f $FILE up redis2 &

echo "Starting relayer1..."
docker-compose -f $FILE up relayer1 &

echo "Starting relayer2..."
docker-compose -f $FILE up relayer2 &

echo "Starting file server..."
npx http-server .. &>/dev/null &
http_server_pid=$!
echo "Building test bundle..."
yarn build:dev &>/dev/null
echo "Running tests..."
npx mocha-chrome index.html --chrome-flags '["--disable-web-security"]' --mocha '{"timeout": 1000000}'
