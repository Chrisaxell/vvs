const https = require('https')
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
  const body = await get('https://www.systembolaget.se/_next/static/chunks/04jjcexl34w_y.js')
  // Show 200 chars of context around each mention of productsearch/search or api-extern
  const rx = /(.{120})(productsearch\/search|api-extern[a-z.\/]*)(.{120})/g
  let m, count = 0
  while ((m = rx.exec(body)) && count < 15) {
    console.log('---')
    console.log((m[1] + '<<<' + m[2] + '>>>' + m[3]).replace(/\s+/g, ' '))
    count++
  }
  // Also look for the base URL constant
  const baseRx = /(BASE_URL|API_BASE|apiUrl|baseUrl)\s*[:=]\s*["']([^"']+)["']/g
  console.log('\n=== base URL candidates ===')
  while ((m = baseRx.exec(body))) console.log(' ', m[1], '=', m[2])
})()

