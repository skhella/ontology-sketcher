import { describe, expect, it } from 'vitest'
import { crc32, zip } from './zip'

/** Reads back the names and texts of a stored (uncompressed) zip from its central directory. */
function unzip(bytes: Uint8Array): { name: string; text: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const out = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const start = local + 30 + view.getUint16(local + 26, true)
    const data = bytes.subarray(start, start + size)
    expect(crc32(data)).toBe(view.getUint32(at + 16, true))
    out.push({ name, text: decoder.decode(data) })
    at += 46 + nameLength
  }
  return out
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('stores each file whole, with UTF-8 names', () => {
    const files = [
      { name: 'Prozessanlage-Übersicht.ttl', text: '@prefix : <http://example.org/> .\n' },
      { name: 'empty.svg', text: '' },
    ]
    expect(unzip(zip(files, new Date(2026, 9, 22, 12, 0, 0)))).toEqual(files)
  })
})
