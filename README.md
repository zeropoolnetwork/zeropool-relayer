# Relayer

## How to start locally

1. For development and testing you have to [install](https://rustwasm.github.io/wasm-pack/installer/) `wasm-pack`:

You can optionally install `wasm-opt` to perform some optimizations to the client wasm library

2. Initialize repo

```bash
yarn initialize
```

3. Copy proving params to local machine

```bash
./scripts/copy_params.sh
```

4. Add `.env` configuration file

5. Start local ganache and deploy contracts

```bash
./scripts/deploy.sh
```

6. Start relayer
    * Locally
    ```bash
    yarn start:dev
    ```
    * Using docker
    ```bash
    docker-compose up relayer
    ```

## Test

```bash
yarn test
```

## Local configuration

* You cat change env parameters `MOCK_TREE_VERIFIER` and `MOCK_TX_VERIFIER` in Dockerfile (also change deploy script to save params locally) to enable/disable mock verifiers


## API

`/transaction` - submit a transaction to relayer

Recieved:
```json
{
    proof, // TX proof
    memo, // memo block
    txType, // 0 - Deposit, 1 - Transfer, 2 - Withdraw
    depositSignature // Optional nullifier signature for Depost
}
```

`/proof_tx` - proove tx. Use only for tests. Tx proof must be calculated on client side but for now it is slow

Recieved:
```json
{
    pub, // public inputs for tx circuit
    sec, // secret inputs for tx circuit
}
```

Returns:
```json
{
    inputs: Array<string>;
    proof: SnarkProof;
}
```

`/transactions/:limit/:offset` - get transactions at indecies `[offset, offset+128 .. offset+limit*128]` and for each return string `out_commit+memo`

Returns:
```json
(Buffer|null)[]
```

`/merkle/proof?[index]` - recieves list of indecies as get params

Returns
```json
{
    root, // indicates state of the tree for returned proofs
    deltaIndex, // this index should be used for building tx proof
    proofs, // merkle proofs
}
```
