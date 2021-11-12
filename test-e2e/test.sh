#!/usr/bin/env bash

trap cleanup EXIT

cleanup() {
  [[ ! -z "$http_server_pid" ]] && kill $http_server_pid
  docker-compose rm -s -f relayer
  docker-compose down -v
}
cleanup

cd ..
echo "Deploying contracts..."
./scripts/deploy.sh &>/dev/null &
sleep 15
echo "Starting relayer..."
docker-compose run -e RPC_URL=http://ganache:8545 -e RELAYER_REDIS_URL=redis:6379 -p 8000:8000 relayer &
cd -

echo "Staring redis..."
docker-compose up redis &>/dev/null &

echo "Starting file server..."
npx http-server .. &>/dev/null &
http_server_pid=$!
echo "Building test bundle..."
yarn build:dev &>/dev/null
echo "Running tests..."
npx mocha-chrome index.html --chrome-flags '["--disable-web-security"]' --mocha '{"timeout": 1000000}'
