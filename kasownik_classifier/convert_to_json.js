const fs = require('fs')

// INSTRUCTIONS FOR GENERATION:
// psql -h 127.0.0.1 -U radex kasownik
// \copy (select * from raw_transfer) to 'raw_transfers.txt' delimiter '~' csv header;
// scp radex@hackerspace.pl:~/raw_transfers.txt .
// node convert_to_json.js

function zipObj(keys, values) {
  const obj = {}
  if (keys.length !== values.length) {
    console.error(keys)
    console.error(values)
    throw new Error(`broken row`)
  }
  keys.forEach((key, i) => {
    obj[key] = values[i]
  })
  return obj
}

function convert() {
  let data = fs.readFileSync('raw_transfers.txt').toString('utf8').trim().split('\n')
  const header = data.shift().split('~')
  console.log(header)
  const rows = data.filter(Boolean).map((row) => zipObj(header, row.split('~')))
  const json = JSON.stringify(rows, null, '  ')
  fs.writeFileSync('raw_transfers.json', json)
}

convert()
k
