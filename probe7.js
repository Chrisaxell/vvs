const https = require('https')
function probe(url) {
  return new Promise(resolve => {
    https.get(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': 'cfc702aed3094c86b92d6d4ff7a54c84',
        'Origin': 'https://www.systembolaget.se',
        'Referer': 'https://www.systembolaget.se/',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, len: data.length, body: data.slice(0, 200) }))
    }).on('error', e => resolve({ err: e.message }))
  })
}
const qs = 'size=5&page=1&sortBy=Score&sortDirection=Descending&searchQuery=smirnoff'
const urls = [
  `https://api-extern.systembolaget.se/productsearch/search?${qs}`,
  `https://api-extern.systembolaget.se/productsearch/v1/search?${qs}`,
  `https://api-extern.systembolaget.se/v1/productsearch/search?${qs}`,
  `https://api-extern.systembolaget.se/sb-api-ecommerce/productsearch/v1/search?${qs}`,
  `https://api-extern.systembolaget.se/sb-api-ecommerce/v1/productsearch/search?${qs}`,
  `https://api-extern.systembolaget.se/ecommerce/v1/productsearch/search?${qs}`,
  `https://api-extern.systembolaget.se/api/productsearch/v1/search?${qs}`,
  `https://api-extern.systembolaget.se/api/v1/productsearch/search?${qs}`,
]
;(async () => {
  for (const u of urls) {
    const r = await probe(u)
    console.log(r.status, r.len, u)
    if (r.status === 200) console.log('  BODY:', r.body)
  }
})()

