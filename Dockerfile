FROM rust:1.54.0-slim-buster as verifier

WORKDIR /app

RUN cargo install --git https://github.com/zeropoolnetwork/libzeropool && \
    libzeropool-setup setup -c tree_update -p tree_params.bin -v tree_vk.json && \
    libzeropool-setup generate-verifier -s TreeVerifier.sol -n TreeVerifier -v tree_vk.json && \
    libzeropool-setup setup -c transfer -p tx_params.bin -v tx_vk.json && \
    libzeropool-setup generate-verifier -s TransferVerifier.sol -n TransferVerifier -v tx_vk.json


FROM node:12

WORKDIR /app

COPY ./pool-evm-single-l1/package*.json ./

RUN npm install

COPY ./pool-evm-single-l1/ ./

COPY --from=verifier /app/TreeVerifier.sol /app/contracts/
COPY --from=verifier /app/TransferVerifier.sol /app/contracts/

COPY --from=verifier /app/tree_params.bin /app/
COPY --from=verifier /app/tx_params.bin /app/

COPY --from=verifier /app/tree_vk.json /app/
COPY --from=verifier /app/tx_vk.json /app/

RUN npx hardhat compile

ENV MOCK_TREE_VERIFIER=false
ENV MOCK_TX_VERIFIER=true

CMD npx hardhat run --network docker scripts/deploy-task.js
