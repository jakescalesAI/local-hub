// A stand-in for the Hub's stdio MCP helpers: reads stdin, answers on stdout, exits.
let text = ''
process.stdin.on('data', chunk => { text += chunk })
process.stdin.on('end', () => process.stdout.write(`echo:${text}\n`))
