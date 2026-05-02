/**
 * 全データソースを順番に更新するマスタースクリプト。
 * 新しいデータソース（CPI、雇用統計、GDPなど）を追加したら
 * このファイルにimportを1行追加するだけでよい。
 */
import 'dotenv/config'

const start = Date.now()
console.log(`[${new Date().toISOString()}] データ更新開始`)

// MHLW実質賃金（毎月更新）
console.log('\n--- MHLW 実質賃金 ---')
await import('./refresh/mhlw.js')

// e-Stat賃金（歴史的データ、変更があれば手動で個別実行）
// await import('./refresh/wages.js')

// 将来追加予定:
// console.log('\n--- CPI 物価指数 ---')
// await import('./refresh/cpi.js')
//
// console.log('\n--- 雇用統計 ---')
// await import('./refresh/employment.js')
//
// console.log('\n--- GDP ---')
// await import('./refresh/gdp.js')

console.log(`\n[${new Date().toISOString()}] 完了 (${((Date.now() - start) / 1000).toFixed(1)}秒)`)
