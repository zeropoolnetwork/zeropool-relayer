type Field =
  'selector' |
  'nullifier' |
  'outCommit' |
  'txType' |
  'memoSize' |
  'memo'

type FieldMapping = {
  [key in Field]: { start: number, size: number }
}

export class PoolCalldataParser {
  private fields: FieldMapping = {
    selector: { start: 0, size: 4 },
    nullifier: { start: 4, size: 32 },
    outCommit: { start: 36, size: 32 },
    txType: { start: 634, size: 1 },
    memoSize: { start: 635, size: 2 },
    memo: { start: 637, size: 0 },
  }
  constructor(private calldata: Buffer) { }

  getField(f: Field, defaultSize?: number) {
    let { start, size } = this.fields[f]
    size = defaultSize || size
    return '0x' + this.calldata.slice(start, start + size).toString('hex')
  }

}