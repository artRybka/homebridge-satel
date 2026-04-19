/**
 * Extract framed Satel messages (FE FE ... FE 0D) from a streaming TCP byte buffer.
 *
 * The library `satel-integra-integration-protocol` handles CRC + destuffing inside
 * `decodeMessage`; this splitter only needs to cut the TCP stream on frame
 * boundaries. Byte stuffing (FE -> FE F0) guarantees that neither `FE FE` nor
 * `FE 0D` can appear inside a payload, so a literal byte-pair scan is safe.
 */
export class FrameSplitter {
  private buffer: Buffer = Buffer.alloc(0);

  append(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  next(): Buffer | null {
    const start = this.findStart();
    if (start < 0) {
      this.trimLeadingGarbage();
      return null;
    }
    if (start > 0) {
      this.buffer = this.buffer.subarray(start);
    }
    if (this.buffer.length < 4) {
      return null;
    }
    for (let j = 2; j + 1 < this.buffer.length; j++) {
      if (this.buffer[j] === 0xfe && this.buffer[j + 1] === 0x0d) {
        const frame = Buffer.from(this.buffer.subarray(0, j + 2));
        this.buffer = this.buffer.subarray(j + 2);
        return frame;
      }
    }
    return null;
  }

  drainAll(): Buffer[] {
    const frames: Buffer[] = [];
    for (;;) {
      const f = this.next();
      if (!f) break;
      frames.push(f);
    }
    return frames;
  }

  private findStart(): number {
    for (let i = 0; i + 1 < this.buffer.length; i++) {
      if (this.buffer[i] === 0xfe && this.buffer[i + 1] === 0xfe) {
        return i;
      }
    }
    return -1;
  }

  private trimLeadingGarbage(): void {
    // Keep only the last byte if it's FE (might be the first byte of a pending FE FE).
    if (this.buffer.length === 0) return;
    const last = this.buffer[this.buffer.length - 1];
    this.buffer = last === 0xfe ? Buffer.from([0xfe]) : Buffer.alloc(0);
  }
}
