#!/usr/bin/env bash

trap cleanup EXIT

cleanup() {
  [[ ! -z "$http_server_pid" ]] && kill $http_server_pid
  docker-compose stop contracts relayer
  docker-compose kill contracts relayer
}
cleanup

cd ..
echo "Deploying contracts..."
./scripts/deploy.sh &>/dev/null &
sleep 15
echo "Starting relayer..."
docker-compose run -e RPC_URL=ws://ganache:8545 -p 8000:8000 relayer &
cd -

echo "Starting file server..."
npx http-server &>/dev/null &
http_server_pid=$!
echo "Building test bundle..."
yarn build:dev &>/dev/null
echo "Running tests..."
npx mocha-chrome index.html --chrome-flags '["--disable-web-security"]' --mocha '{"timeout": 1000000}'
