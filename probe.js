const fs = require('fs')
const h = fs.readFileSync('sb.html', 'utf8')
console.log('has __NEXT_DATA__:', h.includes('__NEXT_DATA__'))
console.log('has "products":', (h.match(/"products"/g) || []).length, 'occurrences')
console.log('has productNumber:', (h.match(/productNumber/g) || []).length, 'occurrences')
const hosts = [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]*systembolaget[a-z0-9./_?=&%-]*/gi)].map(m => m[0]))]
console.log('\nSB URLs referenced (' + hosts.length + '):')
hosts.slice(0, 40).forEach(u => console.log(' ', u))

// Extract __NEXT_DATA__ and see how big products arrays are
const m = h.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
if (m) {
  try {
    const data = JSON.parse(m[1])
    // Walk and count product-looking arrays
    let counts = []
    function walk(node, path) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        if (node.length > 0 && typeof node[0] === 'object' && node[0] && ('productNumber' in node[0] || 'productId' in node[0])) {
          counts.push({ path, len: node.length, sample: node[0].productNameBold || node[0].name })
        }
        node.forEach((v, i) => walk(v, path + '[' + i + ']'))
      } else {
        for (const k of Object.keys(node)) walk(node[k], path + '.' + k)
      }
    }
    walk(data, '$')
    console.log('\nProduct arrays in __NEXT_DATA__:')
    counts.forEach(c => console.log(' ', c.len, 'items at', c.path.slice(0, 90), '  first:', c.sample))
    // Also look for interesting keys near the top
    console.log('\npageProps keys:', Object.keys(data.props?.pageProps || {}))
  } catch (e) {
    console.error('parse error:', e.message)
  }
}

