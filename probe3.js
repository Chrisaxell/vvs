const fs = require('fs')
const https = require('https')

const h = fs.readFileSync('sb-js.html', 'utf8')
const scripts = [...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1])

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

(async () => {
  const hits = new Map() // url pattern -> which chunk
  for (const s of scripts) {
    const url = s.startsWith('http') ? s : 'https://www.systembolaget.se' + s
    try {
      const body = await get(url)
      // Find api-extern URLs and any 'search' / 'product' path fragments in string literals
      const rxs = [
        /api-extern\.systembolaget\.se[a-z0-9./_%-]*/gi,
        /\/[a-z0-9-]*(product|search|filtered|catalog)[a-z0-9./_%-]*/gi,
      ]
      for (const rx of rxs) {
        for (const m of body.matchAll(rx)) {
          const v = m[0]
          if (v.length < 5 || v.length > 200) continue
          if (!hits.has(v)) hits.set(v, s)
        }
      }
    } catch (e) { /* ignore */ }
  }
  console.log('=== api-extern hits ===')
  for (const [k, v] of hits) {
    if (k.includes('api-extern')) console.log(' ', k, '(from', v, ')')
  }
  console.log('\n=== path-fragment hits (search/product/etc) ===')
  const paths = [...hits.keys()].filter(k => !k.includes('api-extern') && (k.includes('search') || k.includes('product') || k.includes('filtered') || k.includes('catalog')))
  paths.slice(0, 40).forEach(p => console.log(' ', p))
})()

