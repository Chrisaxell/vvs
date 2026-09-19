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
  // Grab the chunk that wraps the fetch (has Q.default) — likely the SWR/fetcher chunk.
  // First, find where "v1" is combined with a base path.
  const scripts = [
    '/_next/static/chunks/0sxy4uve1-uwv.js',
    '/_next/static/chunks/0djqpgn_jl.qv.js',
    '/_next/static/chunks/0xndxhx5_4td3.js',
    '/_next/static/chunks/04jjcexl34w_y.js',
  ]
  for (const s of scripts) {
    const body = await get('https://www.systembolaget.se' + s)
    // Look for API_MANAGEMENT_URL usage: something like `${API_URL}/${apiName}/${version}${path}`
    const rx = /(.{80})(API_MANAGEMENT_URL|api-extern\.systembolaget\.se)(.{200})/g
    let m, count = 0
    console.log('\n===', s, '===')
    while ((m = rx.exec(body)) && count < 4) {
      console.log('---')
      console.log((m[1] + '<<<' + m[2] + '>>>' + m[3]).replace(/\s+/g, ' '))
      count++
    }
  }
})()

