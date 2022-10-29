// Taken and adapted from borsh-js

import BN from 'bn.js';

const textDecoder = new TextDecoder('utf-8', { fatal: true });

const INITIAL_LENGTH = 1024;

export class BorshError extends Error {
  originalMessage: string;
  fieldPath: string[] = [];

  constructor(message: string) {
    super(message);
    this.originalMessage = message;
  }

  addToFieldPath(fieldName: string) {
    this.fieldPath.splice(0, 0, fieldName);
    // NOTE: Modifying message directly as jest doesn't use .toString()
    this.message = this.originalMessage + ': ' + this.fieldPath.join('.');
  }
}

/// Binary encoder.
export class BinaryWriter {
  buf: Buffer;
  length: number;

  public constructor() {
    this.buf = Buffer.alloc(INITIAL_LENGTH);
    this.length = 0;
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
    this.buf.writeUInt16LE(value, this.length);
    this.length += 2;
  }

  public writeU32(value: number) {
    this.maybeResize();
    this.buf.writeUInt32LE(value, this.length);
    this.length += 4;
  }

  public writeU64(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray('le', 8)));
  }

  public writeU128(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray('le', 16)));
  }

  public writeU256(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray('le', 32)));
  }

  public writeI256(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toTwos(256).toArray('le', 32)));
  }

  public writeU512(value: number | BN) {
    this.maybeResize();
    this.writeBuffer(Buffer.from(new BN(value).toArray('le', 64)));
  }

  public writeBuffer(buffer: Buffer) {
    // Buffer.from is needed as this.buf.subarray can return plain Uint8Array in browser
    this.buf = Buffer.concat([Buffer.from(this.buf.subarray(0, this.length)), buffer, Buffer.alloc(INITIAL_LENGTH)]);
    this.length += buffer.length;
  }

  public writeDynamicBuffer(buffer: Buffer) {
    this.maybeResize();
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
          throw new BorshError('Reached the end of buffer when deserializing');
        }
      }
      throw e;
    }
  };
}

export class BinaryReader {
  buf: Buffer;
  offset: number;

  public constructor(buf: Buffer) {
    this.buf = buf;
    this.offset = 0;
  }

  @handlingRangeError
  readU8(): number {
    const value = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  @handlingRangeError
  readU16(): number {
    const value = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  @handlingRangeError
  readU32(): number {
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  @handlingRangeError
  readU64(): BN {
    const buf = this.readBuffer(8);
    return new BN(buf, 'le');
  }

  @handlingRangeError
  readU128(): BN {
    const buf = this.readBuffer(16);
    return new BN(buf, 'le');
  }

  @handlingRangeError
  readU256(): BN {
    const buf = this.readBuffer(32);
    return new BN(buf, 'le');
  }

  @handlingRangeError
  readI256(): BN {
    const buf = this.readBuffer(32);
    return new BN(buf, 'le').fromTwos(256);
  }

  @handlingRangeError
  readU512(): BN {
    const buf = this.readBuffer(64);
    return new BN(buf, 'le');
  }

  private readBuffer(len: number): Buffer {
    if ((this.offset + len) > this.buf.length) {
      throw new BorshError(`Expected buffer length ${len} isn't within bounds`);
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

  isEmpty(): boolean {
    return this.offset === this.buf.length;
  }

  @handlingRangeError
  readString(): string {
    const len = this.readU32();
    const buf = this.readBuffer(len);
    try {
      // NOTE: Using TextDecoder to fail on invalid UTF-8
      return textDecoder.decode(buf);
    } catch (e) {
      throw new BorshError(`Error decoding UTF-8 string: ${e}`);
    }
  }

  @handlingRangeError
  readFixedArray(len: number, fn: any): any[] {
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = fn();
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
  readBufferUntilEnd(): Buffer | null {
    const len = this.buf.length - this.offset;

    if (len <= 0) {
      return null;
    }

    return this.readBuffer(len);
  }
}
