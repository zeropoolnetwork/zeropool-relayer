#!/usr/bin/env bash

set -e

cleanup() {
  if [ "$KEEP_RUNNING" != true ]; then
    docker-compose down
  fi
}
cleanup

echo "Starting our own ganache instance"
docker-compose up ganache &
pid=$!
sleep 3
echo "Deploy ZP contracts"
docker-compose up contracts

wait $pid
