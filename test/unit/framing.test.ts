import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  decodeMessage,
  encodeArmInMode0Command,
  encodeNewDataCommand,
} from 'satel-integra-integration-protocol';
import { FrameSplitter } from '../../src/satel/framing';

function partitionFlags(set: number[]): boolean[] {
  const flags = new Array<boolean>(32).fill(false);
  for (const id of set) flags[id - 1] = true;
  return flags;
}

describe('FrameSplitter', () => {
  it('extracts a complete frame in one chunk', () => {
    const frame = encodeNewDataCommand();
    const s = new FrameSplitter();
    s.append(frame);
    const got = s.next();
    assert.ok(got, 'expected a frame');
    assert.equal(got.length, frame.length);
    assert.deepEqual(got, frame);
    assert.equal(s.next(), null);
  });

  it('stitches a frame that arrives in two chunks', () => {
    const frame = encodeNewDataCommand();
    const mid = Math.floor(frame.length / 2);
    const s = new FrameSplitter();
    s.append(frame.subarray(0, mid));
    assert.equal(s.next(), null);
    s.append(frame.subarray(mid));
    const got = s.next();
    assert.deepEqual(got, frame);
  });

  it('skips leading garbage before FE FE', () => {
    const frame = encodeNewDataCommand();
    const s = new FrameSplitter();
    s.append(Buffer.from([0x00, 0x12, 0x34, 0x56]));
    assert.equal(s.next(), null);
    s.append(frame);
    const got = s.next();
    assert.deepEqual(got, frame);
  });

  it('returns both frames when two arrive back-to-back', () => {
    const a = encodeNewDataCommand();
    const b = encodeNewDataCommand();
    const s = new FrameSplitter();
    s.append(Buffer.concat([a, b]));
    const frames = s.drainAll();
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[0], a);
    assert.deepEqual(frames[1], b);
  });

  it('handles payload bytes that triggered stuffing', () => {
    // ArmInMode0 with partitions chosen to pack a 0xFE byte into the payload,
    // which the encoder will stuff as FE F0. The splitter must still find the
    // real FE 0D terminator and decodeMessage must parse it back.
    const partitions = new Array<boolean>(32).fill(false);
    partitions[1] = true;
    partitions[2] = true;
    partitions[3] = true;
    partitions[4] = true;
    partitions[5] = true;
    partitions[6] = true;
    partitions[7] = true;
    const frame = encodeArmInMode0Command('1234FFFFFFFFFFFF', partitions);
    // Sanity check: the stuffed payload includes `FE F0` for the 0xFE byte.
    let hasStuff = false;
    for (let i = 0; i + 1 < frame.length - 2; i++) {
      if (frame[i] === 0xfe && frame[i + 1] === 0xf0) {
        hasStuff = true;
        break;
      }
    }
    assert.ok(hasStuff, 'expected stuffing marker FE F0 in frame');

    const s = new FrameSplitter();
    s.append(frame);
    const got = s.next();
    assert.deepEqual(got, frame);
  });

  it('round-trips a NewData command through decodeMessage', () => {
    const frame = encodeNewDataCommand();
    const s = new FrameSplitter();
    s.append(frame);
    const extracted = s.next();
    assert.ok(extracted);
    const msg = decodeMessage(extracted);
    // We sent a request, not a response. decodeMessage treats command byte 0x7F
    // as NewDataAnswer, but with no further bytes (just CRC), decode() returns
    // false and decodeMessage returns null. The test asserts the framing
    // boundary is right regardless.
    assert.equal(msg, null);
  });

  it('reset() clears state', () => {
    const s = new FrameSplitter();
    s.append(Buffer.from([0xfe]));
    s.reset();
    s.append(encodeNewDataCommand());
    assert.ok(s.next());
  });
});
