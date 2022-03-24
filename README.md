# Relayer

## How to start locally

1. Initialize repo

```bash
yarn initialize
```

2. Pull latest docker images (optional)

```bash
docker-compose pull
```

3. Add `.env` configuration file

4. You can use your own generated proving params or copy ones used for testing

```bash
./scripts/copy_params.sh
```

5. Start local ganache and deploy contracts

```bash
./scripts/deploy.sh
```

6. Start redis

```bash
docker-compose up redis
```

7. Start relayer
    * Locally
    ```bash
    yarn start:dev
    ```
    * Using docker
    ```bash
    docker-compose up relayer
    ```

## Unit tests

```bash
yarn test
```

## API

`/transaction` - submit a transaction to relayer

Recieved:
```
{
    proof, // TX proof
    memo, // memo block
    txType, // 0 - Deposit, 1 - Transfer, 2 - Withdraw
    depositSignature // Optional nullifier signature for Depost
}
```

`/proof_tx` - proove tx. Use only for tests. Tx proof must be calculated on client side but for now it is slow

Recieved:
```
{
    pub, // public inputs for tx circuit
    sec, // secret inputs for tx circuit
}
```

Returns:
```
{
    inputs: Array<string>;
    proof: SnarkProof;
}
```

`/transactions/:limit/:offset` - get transactions at indecies `[offset, offset+128 .. offset+limit*128]` and for each return string `out_commit+memo`

Returns:
```
(Buffer|null)[]
```

## Workflow

*High-level overview*:

1. Client fetches all commitments and memo blocks (either from relayer or directly from the blockchain) and decrypts their notes and accounts. All commitments should be stored in local Merkle tree, together with found notes and accounts.
2. Client builds a zk-SNARK proof for the transaction using previously fetched notes and the most recent account. Then this proof, together with public inputs, memo block, and optional nullifier signature (used only for deposits), is sent to the relayer.
3. Relayer adds a job to the queue. It checks that the tx proof is valid, builds another zk-SNARK proof for tree update, sends tx to the blockchain, and updates the local Merkle tree using sent data. It also locally stores commitment hash (one of the public inputs) and memo messages.

You can use already implemented [client](https://github.com/zeropoolnetwork/libzeropool-rs/tree/main/libzeropool-rs-wasm) to interact with the protocol.


*Technical overview of* `libzeropool-rs`:

1. Client uses *IndexedDB* as storage for accounts, notes, and Merkle tree nodes.

2. You can create or restore an account via `createAccount` function, providing a secret key and state.

3. Then, you can request commitments and memos for previous transactions via `/transactions/:limit/:offset` relayer endpoint.

4. Decrypt incoming notes with `decryptNotes` and add them with `addReceivedNote`. Decrypt your accounts with `decryptPair` and add them with `addAccount`.

5. Insert received commitments and decoded hashes of leaves in the tree 

6. Call `createTx` function, providing correct `deltaIndex`, which is basically the index of the first leaf in the next transaction (`(txNum + 1) * 128`). It will generate a tx object.

7. If you are making a deposit, generate a signature for the tx nullifier (you can get it from `tx_object.public.nullifier`) and store it.

8. Generate a proof for this tx object either with `Proof.tx` method or request it from relayer `/proof_tx` (only for testing).

9. Send `proof`, `memo` (get it from `tx_object.memo`), `txType` (`0..2`) and `depositSignature` to `/transaction` endpoint.

You can check more details in `test-e2e` example