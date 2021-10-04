# Relayer

## How to start locally

1. For development and testing you have to [install](https://rustwasm.github.io/wasm-pack/installer/) `wasm-pack`:

You can optionally install `wasm-opt` to perform some optimizations to the client wasm library

1. Initialize repo

```bash
yarn initialize
```

1. Copy proving params to local machine

```bash
./scripts/copy_params.sh
```

1. Add `.env` configuration file

1. Start local ganache and deploy contracts

```bash
./scripts/deploy.sh
```

1. Start relayer
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
