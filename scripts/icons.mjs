import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icons = (...p) => path.join(root, 'src-tauri', 'icons', ...p)
mkdirSync(icons(), { recursive: true })
mkdirSync(path.join(root, 'branding'), { recursive: true })

const STROKE = 0.092
const SEGMENTS = [
  [0.14, 0.56, 0.14, 0.84],
  [0.14, 0.84, 0.86, 0.84],
  [0.86, 0.84, 0.86, 0.56],
  [0.5, 0.14, 0.5, 0.6],
  [0.31, 0.42, 0.5, 0.61],
  [0.69, 0.42, 0.5, 0.61],
]

function segDist(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax,
    dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const inGlyph = (x, y) => SEGMENTS.some((s) => segDist(x, y, s) <= STROKE / 2)

function render(size, paint) {
  const px = new Uint8ClampedArray(size * size * 4)
  const N = 4
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let R = 0,
        G = 0,
        B = 0,
        A = 0
      for (let sj = 0; sj < N; sj++)
        for (let si = 0; si < N; si++) {
          const [cr, cg, cb, ca] = paint((i + (si + 0.5) / N) / size, (j + (sj + 0.5) / N) / size)
          R += cr * ca
          G += cg * ca
          B += cb * ca
          A += ca
        }
      const k = (j * size + i) * 4
      px[k] = A ? R / A : 0
      px[k + 1] = A ? G / A : 0
      px[k + 2] = A ? B / A : 0
      px[k + 3] = (A / (N * N)) * 255
    }
  return px
}

function png(size, px) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc = (buf) => {
    let c = -1
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const squircle = (x, y, half) => Math.abs((x - 0.5) / half) ** 5 + Math.abs((y - 0.5) / half) ** 5 <= 1

function appIcon(size, pad) {
  const half = (1 - 2 * pad) / 2
  return render(size, (x, y) => {
    if (!squircle(x, y, half)) return [0, 0, 0, 0]
    const t = (y - pad) / (1 - 2 * pad)
    const s = 0.56 * (1 - 2 * pad)
    const gx = (x - 0.5) / s + 0.5
    const gy = (y - 0.5) / s + 0.5
    if (gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1 && inGlyph(gx, gy)) return [246, 246, 248, 1]
    return [28 - 14 * t, 28 - 14 * t, 31 - 15 * t, 1]
  })
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const pngs = Object.fromEntries(sizes.map((s) => [s, png(s, appIcon(s, s <= 32 ? 0.02 : 0.09))]))

writeFileSync(path.join(root, 'branding', 'icon.png'), pngs[1024])
writeFileSync(icons('icon.png'), pngs[1024])
writeFileSync(icons('32x32.png'), pngs[32])
writeFileSync(icons('128x128.png'), pngs[128])
writeFileSync(icons('128x128@2x.png'), pngs[256])

{
  const list = [16, 24, 32, 48, 64, 128, 256]
  const head = Buffer.alloc(6 + 16 * list.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(list.length, 4)
  let offset = head.length
  list.forEach((s, i) => {
    const e = 6 + i * 16
    head[e] = s >= 256 ? 0 : s
    head[e + 1] = s >= 256 ? 0 : s
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(pngs[s].length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += pngs[s].length
  })
  writeFileSync(icons('icon.ico'), Buffer.concat([head, ...list.map((s) => pngs[s])]))
}

{
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ]
  const body = Buffer.concat(
    entries.map(([t, s]) => {
      const h = Buffer.alloc(8)
      h.write(t, 0, 'ascii')
      h.writeUInt32BE(pngs[s].length + 8, 4)
      return Buffer.concat([h, pngs[s]])
    }),
  )
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'ascii')
  h.writeUInt32BE(body.length + 8, 4)
  writeFileSync(icons('icon.icns'), Buffer.concat([h, body]))
}

console.log('icons written')
