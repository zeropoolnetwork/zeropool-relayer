# Relayer

## How to start locally

1. Initialize repo

```bash
yarn initialize
```

2. Start local ganache and deploy contracts

```bash
./scripts/deploy.sh
```

3. Add `.env` configuration file

4. Start relayer
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
