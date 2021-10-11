#!/usr/bin/env bash

set -e

docker-compose build contracts

echo "Starting our own ganache instance"
docker-compose up ganache &
pid=$!
sleep 3
echo "Deploy ZP contracts"
docker-compose up contracts

wait $pid
