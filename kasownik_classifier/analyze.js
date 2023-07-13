const fs = require('fs')
const fp = require('rambdax')

let rawTransfers = JSON.parse(fs.readFileSync('raw_transfers.json').toString('utf8'))
rawTransfers = fp.piped(rawTransfers, fp.sortByPath('date'))

const pad = (chars, text, padding = ' ') => {
  return `${text}${Array(Math.max(chars - text.length, 0)).join(padding)}`
}
const padRight = (chars, text, padding = ' ') => {
  return `${Array(Math.max(chars - text.length, 0) + 1).join(padding)}${text}`
}
const formatAmmount = (amount) => {
  const zl = amount >= 100 ? String(amount).slice(0, -2) : '0'
  const gr = String(amount).slice(-2)
  return zl + ',' + padRight(2, gr, '0')
}
const toPln = (currency) => {
  switch (currency) {
    case 'PLN':
      return 1.0
    case 'EUR':
      return 4.57
    default:
      throw new Error('Unknown currency multiplier for ' + currency)
  }
}
const sign = (transfer) => {
  return transfer.type.startsWith('IN') ? 1 : -1
}
const transferPlnValue = (transfer) => {
  return sign(transfer) * Number(transfer.amount) * toPln(transfer.currency)
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
function printTransfer(transfer) {
  const { title, type, date, amount, currency } = transfer
  // type: [ 'IN', 'OUT_TO_OWN', 'BANK_FEE', 'IN_FROM_OWN', 'OUT' ]
  const sign = type.startsWith('IN') ? '+' : '-'
  console.log(
    `${date} | ${pad(15, classify(transfer))} | ${pad(80, title)} | ${sign} ${padRight(
      8,
      formatAmmount(amount),
    )} ${currency}`,
  )
}
function classify(transfer) {
  if (
    transfer.type === 'IN' &&
    (transfer.to_account === 'PL48195000012006000648890002' ||
      transfer.title.match(/^\w+ ?- ?(fatty|starving|superfatty) ?- ?sk(l|ł)adka/i) ||
      transfer.title.match(/^sk(l|ł)adka ?- \w+ ?- ?\d+ ?m/i) ||
      transfer.title.match(/skladka - wooddy/i)) &&
    !transfer.title.match(/(kaucj|zwrot|lokata|grant|covid)/i)
  ) {
    return 'memberships'
  }
  if (
    transfer.type === 'BANK_FEE' ||
    transfer.title.match(
      /(Opłata za przelew|Miesięczny abonament|ZWROT OPŁATY ZA PROWADZENIE RACHUNKU)/,
    )
  ) {
    return 'bank_fees'
  }
  if (
    transfer.type === 'OUT' &&
    (transfer.to_name.includes('RIPE') ||
      transfer.to_name.includes('Stowarzyszenie e-Południe') ||
      transfer.to_name.includes('Nitronet sp. z o. o.') ||
      transfer.to_name.includes('Nitronet sp. z o.o.'))
  ) {
    return 'isp_fees'
  }
  if (
    transfer.to_name === 'PSP Zjednoczenie' ||
    transfer.title.startsWith('CZYNSZ - GRZYBOWSKA 85c') ||
    transfer.title.match(/(zwrot kaucji|zwrot wadium|najem lokali)/i)
  ) {
    return 'rent'
  }
  if (
    transfer.type === 'OUT' &&
    (transfer.to_name.startsWith('A&M') ||
      transfer.title.match(/usługi prawne/i) ||
      transfer.to_name.match(/Lookreatywni/))
  ) {
    return 'legal'
  }
  if (
    (transfer.type === 'IN' &&
      transfer.to_account === 'PL64195000012006000648890005' &&
      transfer.title.toLowerCase().includes('fv')) ||
    transfer.title.match(/internet BGP.WTF/i) ||
    transfer.title.match(/internet - umowa HSWAW/i) ||
    transfer.title.includes('Invoice N. FV/21043')
  ) {
    return 'bgp_wtf_income'
  }
  if (
    transfer.type === 'IN' &&
    transfer.date.startsWith('2020-') &&
    transfer.title.match(
      /(coronavirus|c.vid|przy(ł|l)bic|curvovid|powodzenia m|owner w k|dzialal. promocyj.|^Przelew$|^TRANSFER$|^Outgoing payment$)/i,
    )
  ) {
    return 'covid19_donation'
  }
  if (
    transfer.type === 'OUT' &&
    transfer.date >= '2020-03-31' &&
    transfer.date <= '2020-06-24' &&
    transfer.from_account === 'PL91195000012006000648890004'
  ) {
    return 'covid19'
  }
  if (
    transfer.type === 'IN' &&
    transfer.to_account === 'PL64195000012006000648890005' &&
    transfer.title.match(/(koszulk|\d ?szt)/i)
  ) {
    return 'swag_sale'
  }
  if (transfer.type === 'IN' && transfer.title.match(/(grant|mikrodotacja|transza)/i)) {
    return 'grant'
  }
  const projectDonation = transfer.title.match(
    /(^\w+[\s-]*(?:darowizna|darownizna|DAROWNIZNA)[\s-]*(.*)$|(?:skladka|darowizna) celowa -? ?(.*)$|skladka na pokrycie (.*)|na zakup (.*)|darowizna na (.*))/i,
  )
  if (transfer.type === 'IN' && projectDonation && !transfer.title.match(/cele statutowe/)) {
    const cause = projectDonation.slice(2).filter(Boolean)[0]
    return `donation_cause`
    // return `donation: ${cause.toLowerCase()}`
  }
  if (transfer.type === 'IN' && transfer.title.match(/(darowizn|uk online giving|testow)/i)) {
    return `donation`
  }
  if (
    transfer.type === 'OUT' &&
    transfer.title.match(
      /(Leroy Merlin Warszawa|Castorama Warszawa|bricoman.pl|zakup materiałów budowlanych|Market Budowlany)/i,
    )
  ) {
    return 'construction'
  }
  if (transfer.title.match(/(zwrot z podatku vat|KRS)/i)) {
    return 'taxes'
  }
  if (transfer.from_name.match(/CURRENCY ONE/i) || transfer.to_name.match(/CURRENCY ONE/i)) {
    return 'currency_exchange'
  }
  if (transfer.title.match(/lokata nr/i)) {
    return 'time_deposit'
  }
  if (
    transfer.type === 'OUT' &&
    (transfer.title.match(/(stal hutnicza|stawex)/) ||
      transfer.to_name.match(/stawex/i) ||
      transfer.to_name.match(/nor-gaz/i))
  ) {
    return 'materials'
  }
  if (
    transfer.type === 'OUT' &&
    transfer.title.match(/(^zwrot |Zakup przy użyciu karty|PayU w Allegro|Przelewy24|^zwroty )/i)
  ) {
    return 'purchases'
  }
  if (transfer.type === 'OUT' && transfer.to_name.match(/(eniy soro|radosław pietruszewski)/i)) {
    return 'purchases_returns'
  }
  if (
    transfer.type === 'OUT' &&
    (transfer.date === '2021-12-21' || transfer.to_name.startsWith('Maker Kids Michał'))
  ) {
    return 'grant_expenses'
  }
  if (transfer.type === 'IN') {
    return 'in?'
  }
  if (transfer.type === 'OUT') {
    return 'out?'
  }
  return '??'
}

const printTransfers = (transfers) => {
  transfers.forEach(printTransfer)
  console.log('')

  const total = sum(transfers.map(transferPlnValue))
  console.log(`Total: ${Math.round(total) / 100} PLN`)
  console.log(`Total/mo: ${Math.round(total / 12 / 100)} PLN`)
  console.log(`Transfers: ${transfers.length}`)
}

const printCategorized = (transfers) => {
  const categories = {}
  transfers.forEach((tx) => {
    const type = classify(tx)
    if (!categories[type]) {
      categories[type] = []
    }
    categories[type].push(tx)
  })

  Object.entries(categories).map(([category, categoryTransfers]) => {
    console.log('')
    console.log('___________________________')
    console.log(`Category: ${category}`)
    console.log('')
    printTransfers(categoryTransfers)
  })
}

// printCategorized(
//   rawTransfers
//     .filter((x) => classify(x) !== 'memberships')
//     // .filter((x) => classify(x) === 'bank_fees')
//     // .filter((x) => classify(x).startsWith('donation:'))
//     // .filter((x) => x.date.startsWith('2021-'))
//     // .filter((x) => x.amount > 10_000_00)
//     // .filter((x) => x.type === 'OUT_TO_OWN')
//     // .filter((x) => classify(x) === '??')
//     // .filter((x) => x.title.toLowerCase().includes('uk online giving'))
//     // .filter((x) => x.title.match(/kuh/i))
//     // .filter(
//     //   (x) =>
//     //     x.type === 'IN' &&
//     //     x.date.startsWith('2020-') &&
//     //     x.title.match(/(coronavirus|c.vid|przy(ł|l)bic|curvovid)/i),
//     // )
//     // .slice(-500),
//     .concat([]),
// )

const generateMonthDates = () => {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const dates = []
  for (let y = 2016; y <= currentYear; y++) {
    const initialMonth = y == 2016 ? 11 : 1
    const maxMonth = y == currentYear ? currentMonth : 12
    for (let m = initialMonth; m <= maxMonth; m++) {
      dates.push(`${y}-${m < 10 ? 0 : ''}${m}`)
    }
  }
  return dates
}
const monthDates = generateMonthDates()

const printMonthSums = (transfers) => {
  const groupped = fp.piped(
    transfers,
    fp.groupBy((t) => t.date.slice(0, -3)),
  )
  monthDates.forEach((date) => {
    const txs = groupped[date] || []
    const sum = txs.reduce((sum, transfer) => sum + transferPlnValue(transfer), 0)
    console.log(`${date} | ${padRight(8, formatAmmount(Math.round(sum)))}`)
  })
}

// printMonthSums(rawTransfers.filter((x) => classify(x) === 'bank_fees'))

const days = rawTransfers
  .filter((x) => classify(x) !== 'memberships')
  .concat([])
  .map((x) => Number(x.date.match(/.*-(\d{2})$/)[1]))
  .sort()

const dayCounts = Array(32).fill(0)

days.forEach((day) => {
  dayCounts[day] += 1
})

console.log(
  dayCounts
    .slice(1)
    .map((count, day) => ({ day, count }))
    .sort((a, b) => b.count - a.count)
    .map(({ day, count }) => `${day + 1} | ${count}`)
    .join('\n'),
)
