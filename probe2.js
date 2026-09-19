const fs = require('fs')
const h = fs.readFileSync('sb-js.html', 'utf8')
// Extract all script src URLs
const scripts = [...h.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1])
console.log('Script srcs:')
scripts.forEach(s => console.log(' ', s))

