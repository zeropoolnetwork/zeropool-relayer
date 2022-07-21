# Configuration

## Common configuration

| name                        | description                                                                                      | value                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| PORT                        | Relayer port                                                                                     | integer                                                |
| RELAYER_ADDRESS_PRIVATE_KEY | Private key to sign pool transactions                                                            | hexadecimal prefixed with "0x"                         |
| POOL_ADDRESS                | Address of the pool contract                                                                     | hexadecimal prefixed with "0x"                         |
| RELAYER_GAS_LIMIT           | Gas limit for pool transactions                                                                  | integer                                                |
| RELAYER_FEE                 | Minimal accepted relayer fee (in tokens)                                                         | integer                                                |
| MAX_NATIVE_AMOUNT_FAUCET    | Maximal amount of faucet value (in ETH)                                                          | integer                                                |
| TREE_UPDATE_PARAMS_PATH     | Local path to tree update parameters                                                             | string                                                 |
| TX_VK_PATH                  | Local path to transaction curcuit verification key                                               | string                                                 |
| GAS_PRICE_FALLBACK          | Default fallback gas price                                                                       | integer                                                |
| GAS_PRICE_ESTIMATION_TYPE   | Gas price estimation type                                                                        | `web3` / `gas-price-oracle` / `eip1559-gas-estimation` |
| GAS_PRICE_UPDATE_INTERVAL   | Interval in milliseconds used to get the updated gas price value using specified estimation type | integer                                                |
| RELAYER_LOG_LEVEL           | Log level                                                                                        | Winston log level                                      |
| RELAYER_REDIS_URL           | Url to redis instance                                                                            | URL                                                    |
| RPC_URL                     | Url to RPC node                                                                                  | URL                                                    |
