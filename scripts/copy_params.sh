echo "Create container"
c_id=$(docker create lok52/verifier)
echo $c_id

echo "Copy params to local machine"
docker cp $c_id:/app/tree_params.bin ./zp-relayer/tree_params.bin
docker cp $c_id:/app/tx_params.bin ./zp-relayer/transfer_params.bin

echo "Copy keys to local machine"
docker cp $c_id:/app/tree_vk.json ./zp-relayer/tree_verification_key.json
docker cp $c_id:/app/tx_vk.json ./zp-relayer/transfer_verification_key.json
