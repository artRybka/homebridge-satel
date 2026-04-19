import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseNameResponse } from '../../src/satel/discovery';

function buildResponse(type: number, number: number, name: string): Buffer {
  const payload = Buffer.alloc(20);
  payload[0] = 0xee;
  payload[1] = type;
  payload[2] = number;
  payload[3] = 0x01; // arbitrary device kind/subtype
  Buffer.from(name.padEnd(16, ' '), 'latin1').copy(payload, 4, 0, 16);
  return payload;
}

describe('parseNameResponse', () => {
  it('parses a partition name response', () => {
    const buf = buildResponse(0x00, 1, 'Parter');
    const d = parseNameResponse(buf, 'partition', 1);
    assert.ok(d);
    assert.equal(d.id, 1);
    assert.equal(d.name, 'Parter');
  });

  it('parses a zone name response', () => {
    const buf = buildResponse(0x05, 7, 'Drzwi wejsciowe');
    const d = parseNameResponse(buf, 'zone', 7);
    assert.ok(d);
    assert.equal(d.name, 'Drzwi wejsciowe');
  });

  it('parses an output name response', () => {
    const buf = buildResponse(0x04, 3, 'Brama');
    const d = parseNameResponse(buf, 'output', 3);
    assert.ok(d);
    assert.equal(d.name, 'Brama');
  });

  it('returns null when echoed type does not match', () => {
    const buf = buildResponse(0x00, 1, 'X');
    const d = parseNameResponse(buf, 'zone', 1);
    assert.equal(d, null);
  });

  it('returns null when echoed number does not match', () => {
    const buf = buildResponse(0x00, 1, 'X');
    const d = parseNameResponse(buf, 'partition', 2);
    assert.equal(d, null);
  });

  it('returns null for too-short payloads', () => {
    const buf = Buffer.from([0xee, 0x00, 0x01]);
    const d = parseNameResponse(buf, 'partition', 1);
    assert.equal(d, null);
  });

  it('decodes Polish characters from Windows-1250', () => {
    const payload = Buffer.alloc(20);
    payload[0] = 0xee;
    payload[1] = 0x05;
    payload[2] = 1;
    payload[3] = 0x01;
    // "Łazienka " padded to 16 bytes, encoded in win-1250:
    //   Ł = 0xA3, a = 0x61, z = 0x7A, i = 0x69, e = 0x65, n = 0x6E, k = 0x6B, a = 0x61, ' ' = 0x20
    const name = Buffer.from([0xa3, 0x61, 0x7a, 0x69, 0x65, 0x6e, 0x6b, 0x61, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
    name.copy(payload, 4);
    const d = parseNameResponse(payload, 'zone', 1);
    assert.ok(d);
    assert.equal(d.name, 'Łazienka');
  });

  it('trims trailing spaces in the decoded name', () => {
    const buf = buildResponse(0x00, 1, 'Dom');
    const d = parseNameResponse(buf, 'partition', 1);
    assert.ok(d);
    assert.equal(d.name, 'Dom');
  });
});
