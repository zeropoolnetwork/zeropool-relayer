# End-to-end ZP test

1. Deploy contracts

```bash
cd ..
./scripts/deploy.sh
```

2. Start relayer

```bash
cd ..
yarn start:dev
```

3. Install dependencies

```bash
yarn
```

4. Build bundle

```bash
yarn build:dev
```

5. Start local file server

```bash
npx http-server
```

6. Run tests

```bash
./test.sh
```