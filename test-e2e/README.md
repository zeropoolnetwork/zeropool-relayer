# End-to-end ZP test

## How to run

1. Install dependencies

```bash
yarn
```

2. Pull latest docker images (optional)

```bash
docker-compose pull
```

3. Set RPC_URL in `.env` file to `http://ganache:8545`

4. Run test script

```bash
./test.sh
```
