import { describe, expect, it } from 'vitest'
import type { OscMessage } from './encode'
import {
  addrMessage,
  encodeBundle,
  encodeMessage,
  encodePacket,
  fmtMessage,
  noteOff,
  noteOn,
} from './encode'

describe('encodeMessage', () => {
  it('encodes a float message byte-exact', () => {
    const out = encodeMessage({ address: '/ch/1', args: [{ type: 'f', value: 0.5 }] })
    expect(out).toEqual(
      new Uint8Array([47, 99, 104, 47, 49, 0, 0, 0, 44, 102, 0, 0, 63, 0, 0, 0]),
    )
    expect(out.length).toBe(16)
  })

  it('encodes an int arg big-endian', () => {
    const out = encodeMessage({ address: '/n', args: [{ type: 'i', value: 1 }] })
    expect(Array.from(out)).toEqual([47, 110, 0, 0, 44, 105, 0, 0, 0, 0, 0, 1])
  })

  it('encodes a negative int as two-complement 32-bit', () => {
    const out = encodeMessage({ address: '/n', args: [{ type: 'i', value: -1 }] })
    expect(Array.from(out)).toEqual([47, 110, 0, 0, 44, 105, 0, 0, 255, 255, 255, 255])
  })

  it('pads a string arg to a multiple of 4', () => {
    const out = encodeMessage({ address: '/ch/1', args: [{ type: 's', value: 'ab' }] })
    expect(Array.from(out)).toEqual([47, 99, 104, 47, 49, 0, 0, 0, 44, 115, 0, 0, 97, 98, 0, 0])
  })

  it('encodes a multi-arg ifs message', () => {
    const out = encodeMessage({
      address: '/m',
      args: [
        { type: 'i', value: 7 },
        { type: 'f', value: 2.5 },
        { type: 's', value: 'hi' },
      ],
    })
    expect(Array.from(out)).toEqual([
      47, 109, 0, 0, 44, 105, 102, 115, 0, 0, 0, 0, 0, 0, 0, 7, 64, 32, 0, 0, 104, 105, 0, 0,
    ])
    expect(out.length).toBe(24)
  })

  it('prepends a leading slash when missing', () => {
    expect(encodeMessage(addrMessage('fx/x', 0.25))).toEqual(encodeMessage(addrMessage('/fx/x', 0.25)))
  })
})

describe('encodeBundle', () => {
  it('writes #bundle, immediate timetag and length-prefixed messages', () => {
    const m1 = addrMessage('/ch/1', 0.5)
    const m2: OscMessage = { address: '/n', args: [{ type: 'i', value: 1 }] }
    const e1 = encodeMessage(m1)
    const e2 = encodeMessage(m2)
    const out = encodeBundle([m1, m2])
    expect(Array.from(out.slice(0, 8))).toEqual([35, 98, 117, 110, 100, 108, 101, 0])
    expect(Array.from(out.slice(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(Array.from(out.slice(16, 20))).toEqual([0, 0, 0, e1.length])
    expect(out.slice(20, 20 + e1.length)).toEqual(e1)
    expect(Array.from(out.slice(20 + e1.length, 24 + e1.length))).toEqual([0, 0, 0, e2.length])
    expect(out.slice(24 + e1.length)).toEqual(e2)
    expect(out.length).toBe(16 + (4 + e1.length) + (4 + e2.length))
  })
})

describe('encodePacket', () => {
  const m1 = addrMessage('/ch/1', 0.5)
  const m2 = addrMessage('/fx/x', 0.25)

  it('returns a single plain packet for one message even with bundle flag', () => {
    const out = encodePacket([m1], true)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(encodeMessage(m1))
  })

  it('bundles multiple messages when bundle is true', () => {
    const out = encodePacket([m1, m2], true)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual(encodeBundle([m1, m2]))
  })

  it('returns one packet per message when bundle is false', () => {
    const out = encodePacket([m1, m2], false)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(encodeMessage(m1))
    expect(out[1]).toEqual(encodeMessage(m2))
  })

  it('pads strings to preserve 4-byte alignment', () => {
    expect(encodeMessage(m1).length).toBe(16)
    expect(encodeMessage(m2).length % 4).toBe(0)
    expect(encodeBundle([m1, m2]).length % 4).toBe(0)
  })
})

describe('message helpers', () => {
  it('noteOn and noteOff target note addresses', () => {
    expect(noteOn(0, 60, 100).address).toBe('/noteon')
    expect(noteOff(0, 60).address).toBe('/noteoff')
    expect(noteOff(0, 60).args).toEqual([
      { type: 'i', value: 0 },
      { type: 'i', value: 60 },
    ])
  })

  it('fmtMessage renders address and 3-decimal values', () => {
    expect(fmtMessage(addrMessage('/ch/4', 0.7321))).toBe('/ch/4  0.732')
  })
})
