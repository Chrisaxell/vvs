const https = require('https')
const fs = require('fs')
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
  const h = fs.readFileSync('sb-js.html', 'utf8')
  const scripts = [...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1])
  for (const s of scripts) {
    const url = s.startsWith('http') ? s : 'https://www.systembolaget.se' + s
    let body
    try { body = await get(url) } catch { continue }
    if (!body.includes('productsearch/search')) continue
    console.log('\n=== hit in', s, '===')
    // Print context around each mention
    const rx = /(.{200})productsearch\/search(.{200})/g
    let m, count = 0
    while ((m = rx.exec(body)) && count < 6) {
      console.log('---')
      console.log((m[1] + '<<<productsearch/search>>>' + m[2]).replace(/\s+/g, ' '))
      count++
    }
  }
})()

