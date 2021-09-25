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
./scripts/deploy.sh 2>/dev/null &
sleep 10
echo "Starting relayer..."
docker-compose run -e RPC_URL=ws://ganache:8545 -p 8000:8000 relayer &
cd -

echo "Starting file server..."
npx http-server 2>/dev/null &
http_server_pid=$!
echo "Building test bundle..."
yarn build:dev
echo "Running tests..."
npx mocha-chrome index.html --chrome-flags '["--disable-web-security"]' --mocha '{"timeout": 100000}'
