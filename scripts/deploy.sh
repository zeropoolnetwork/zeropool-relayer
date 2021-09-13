#!/usr/bin/env bash

set -e

cleanup() {
  if [ "$KEEP_RUNNING" != true ]; then
    docker-compose down
  fi
}
cleanup

docker-compose build contracts

echo "Copy params to local machine"
c_id=$(docker create lok52/verifier)
echo $c_id
docker cp $c_id:/app/tree_params.bin ./tree_params.bin 
docker cp $c_id:/app/tx_params.bin ./tx_params.bin 

echo "Starting our own ganache instance"
docker-compose up ganache &
pid=$!
sleep 3
echo "Deploy Compound protocol contracts"
docker-compose up contracts

wait $pid
