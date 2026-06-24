// Throughput + constant-time evidence for the HMAC-SHA256 webhook verify.
// Pure CPU, no network. Run: node bench/verify.mjs
import { createHmac } from 'node:crypto'
import { verify } from '../packages/sdk/dist/internal/verify.js'

const secret = 'whsec_' + 'a'.repeat(32)
const body = JSON.stringify({ id: 'evt_' + 'x'.repeat(24), type: 'payment.succeeded', created: 1700000000, data: { object: { amount: 4200, currency: 'usd', items: Array.from({length: 8}, (_, i) => ({ sku: 'SKU-'+i, qty: i+1 })) } } })
const validSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
// wrong signature, SAME length (flip last hex nibble)
const h = validSig.slice(7); const wrong = 'sha256=' + h.slice(0, -1) + (h.slice(-1) === '0' ? '1' : '0')

const N = 500000
function timed(sig) {
  const t0 = process.hrtime.bigint()
  let ok = 0
  for (let i = 0; i < N; i++) if (verify(body, sig, secret)) ok++
  return { ns: Number(process.hrtime.bigint() - t0), ok }
}
timed(validSig) // warm
const v = timed(validSig), w = timed(wrong)
const perValid = v.ns / N / 1000, perWrong = w.ns / N / 1000
console.log(`body_bytes=${body.length} iterations=${N}`)
console.log(`valid:   ${perValid.toFixed(3)} us/verify  (${(1e6/(v.ns/N)).toFixed(0)} verifies/sec)  matched=${v.ok}`)
console.log(`invalid: ${perWrong.toFixed(3)} us/verify  (same-length wrong sig)  matched=${w.ok}`)
console.log(`timing_delta=${(Math.abs(perValid-perWrong)/perValid*100).toFixed(1)}%  (small = constant-time compare holds)`)
console.log(`node=${process.version}`)
