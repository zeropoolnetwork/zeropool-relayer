set -x

echo "Create container"
c_id=$(docker create lok52/verifier)
echo $c_id

workdir=./zp-relayer/params

echo "Copy params to local machine"
docker cp $c_id:/app/tree_params.bin $workdir/tree_params.bin
docker cp $c_id:/app/tx_params.bin $workdir/transfer_params.bin

echo "Copy keys to local machine"
docker cp $c_id:/app/tree_vk.json $workdir/tree_verification_key.json
docker cp $c_id:/app/tx_vk.json $workdir/transfer_verification_key.json
