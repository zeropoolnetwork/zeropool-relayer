// Original: https://github.com/near/borsh-js
// Added support for configurable endianness and dynamic arrays

// TODO: extract into a separate package

import BN from 'bn.js';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

const INITIAL_LENGTH = 1024;

/// Binary encoder.
export class BinaryWriter {
  buf: Buffer;
  length: number;
  endian: BN.Endianness;

  public constructor(endian: BN.Endianness = 'le') {
    this.buf = Buffer.alloc(INITIAL_LENGTH);
    this.length = 0;
    this.endian = endian;
  }

  maybeResize() {
    if (this.buf.length < 16 + this.length) {
      this.buf = Buffer.concat([this.buf, Buffer.alloc(INITIAL_LENGTH)]);
    }
  }

  public writeU8(value: number) {
    this.maybeResize();
    this.buf.writeUInt8(value, this.length);
    this.length += 1;
  }

  public writeU16(value: number) {
    this.maybeResize();
    if (this.endian == 'le') {
      this.buf.writeUInt16LE(value, this.length);
    } else {
      this.buf.writeUInt16BE(value, this.length);
    }
    this.length += 2;
  }

  public writeU32(value: number) {
    this.maybeResize();
    if (this.endian == 'le') {
      this.buf.writeUInt32LE(value, this.length);
    } else {
      this.buf.writeUInt32BE(value, this.length);
    }
    this.length += 4;
  }

  public writeU64(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray(this.endian, 8)));
  }

  public writeU128(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray(this.endian, 16)));
  }

  public writeU256(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray(this.endian, 32)));
  }

  public writeU512(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray(this.endian, 64)));
  }

  public writeBuffer(buffer: Buffer) {
    // Buffer.from is needed as this.buf.subarray can return plain Uint8Array in browser
    this.buf = Buffer.concat([Buffer.from(this.buf.subarray(0, this.length)), buffer, Buffer.alloc(INITIAL_LENGTH)]);
    this.length += buffer.length;
  }

  public writeDynamicBuffer(buffer: Buffer) {
    this.writeU32(buffer.length);
    this.writeBuffer(buffer);
  }

  public writeString(str: string) {
    this.maybeResize();
    const b = Buffer.from(str, 'utf8');
    this.writeU32(b.length);
    this.writeBuffer(b);
  }

  public writeFixedArray(array: Uint8Array) {
    this.writeBuffer(Buffer.from(array));
  }

  public writeArray(array: any[], fn: any) {
    this.maybeResize();
    this.writeU32(array.length);
    for (const elem of array) {
      this.maybeResize();
      fn(elem);
    }
  }

  public toArray(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

function handlingRangeError(target: any, propertyKey: string, propertyDescriptor: PropertyDescriptor) {
  const originalMethod = propertyDescriptor.value;
  propertyDescriptor.value = function (...args: any[]) {
    try {
      return originalMethod.apply(this, args);
    } catch (e) {
      if (e instanceof RangeError) {
        const code = (e as any).code;
        if (['ERR_BUFFER_OUT_OF_BOUNDS', 'ERR_OUT_OF_RANGE'].indexOf(code) >= 0) {
          throw new Error('Reached the end of buffer when deserializing');
        }
      }
      throw e;
    }
  };
}

export class BinaryReader {
  buf: Buffer;
  offset: number;
  endian: BN.Endianness;

  public constructor(buf: Buffer, endian: BN.Endianness = 'le') {
    this.buf = buf;
    this.offset = 0;
    this.endian = endian;
  }

  @handlingRangeError
  readU8(): number {
    const value = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  @handlingRangeError
  readU16(): number {
    let value;
    if (this.endian == 'le') {
      value = this.buf.readUInt16LE(this.offset);
    } else {
      value = this.buf.readUInt16BE(this.offset);
    }
    this.offset += 2;
    return value;
  }

  @handlingRangeError
  readU32(): number {
    let value;
    if (this.endian == 'le') {
      value = this.buf.readUInt32LE(this.offset);
    } else {
      value = this.buf.readUInt32BE(this.offset);
    }

    this.offset += 4;
    return value;
  }

  @handlingRangeError
  readU64(): BN {
    const buf = this.readBuffer(8);
    return new BN(buf, this.endian);
  }

  @handlingRangeError
  readU128(): BN {
    const buf = this.readBuffer(16);
    return new BN(buf, this.endian);
  }

  @handlingRangeError
  readU256(): BN {
    const buf = this.readBuffer(32);
    return new BN(buf, this.endian);
  }

  @handlingRangeError
  readI256(): BN {
    const buf = this.readBuffer(32);
    return new BN(buf, this.endian).fromTwos(256);
  }

  @handlingRangeError
  readU512(): BN {
    const buf = this.readBuffer(64);
    return new BN(buf, this.endian);
  }

  readBuffer(len: number): Buffer {
    if ((this.offset + len) > this.buf.length) {
      throw new Error(`Expected buffer length ${len} isn't within bounds`);
    }
    const result = this.buf.slice(this.offset, this.offset + len);
    this.offset += len;
    return result;
  }

  @handlingRangeError
  public readDynamicBuffer(): Buffer {
    const len = this.readU32();
    return this.readBuffer(len);
  }

  @handlingRangeError
  readString(): string {
    const len = this.readU32();
    const buf = this.readBuffer(len);
    try {
      // NOTE: Using TextDecoder to fail on invalid UTF-8
      return textDecoder.decode(buf);
    } catch (e) {
      throw new Error(`Error decoding UTF-8 string: ${e}`);
    }
  }

  @handlingRangeError
  readFixedArray(len: number, fn: any): any[] {
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result.push(fn());
    }
    return result;
  }

  @handlingRangeError
  readArray(fn: any): any[] {
    const len = this.readU32();
    const result = Array<any>();
    for (let i = 0; i < len; ++i) {
      result.push(fn());
    }
    return result;
  }

  @handlingRangeError
  skip(len: number) {
    this.offset += len;
    const _ = this.buf[this.offset]; // Check if offset is in bounds
  }

  @handlingRangeError
  readBufferUntilEnd(): Buffer | null {
    const len = this.buf.length - this.offset;

    if (len <= 0) {
      return null;
    }

    return this.readBuffer(len);
  }

  isEmpty(): boolean {
    return this.offset === this.buf.length;
  }
}

export function bigintToArrayLe(num: bigint): Uint8Array {
  let result = new Uint8Array(32);

  for (let i = 0; num > BigInt(0); ++i) {
    result[i] = Number(num % BigInt(256));
    num = num / BigInt(256);
  }

  return result;
}
