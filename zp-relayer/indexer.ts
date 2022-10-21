type ZeropoolInfo = {
  version: string,
  num_transactions: string,
}

export type IndexerTx = {
  hash: string,
  block_hash: string,
  block_height: number,
  timestamp: number,
  sender_address: string,
  receiver_address: string,
  signature: string,
  calldata: string,
}

export class ZeropoolIndexer {
  constructor(private url: string) {}

  public async getInfo(): Promise<ZeropoolInfo> {
    const url = this.assembleUrl('/info');
    const res = await fetch(url.toString());
    return await res.json();
  }

  public async getTransaction(hash: string): Promise<IndexerTx | null> {
    const url = this.assembleUrl(`/transactions/${hash}`);
    const res = await fetch(url.toString());
    if (res.status == 404) {
      return null;
    }
    return await res.json();
  }

  public async getTransactions(query: { timestamp?: number, block_height?: number, limit?: number }): Promise<IndexerTx[]> {
    const url = this.assembleUrl('/transactions', query);
    const res = await fetch(url.toString());
    return await res.json();
  }

  assembleUrl(path: string, query: object = {}): URL {
    const url = new URL(this.url);
    url.pathname = path;

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    return url;
  }
}