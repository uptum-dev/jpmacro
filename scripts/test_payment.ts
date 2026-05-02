/**
 * x402 End-to-End Payment Test
 *
 * 必要なもの:
 * 1. .env に TEST_WALLET_PRIVATE_KEY=0x... を追加
 * 2. そのウォレットに Base Sepolia USDC を入金
 *    - USDC faucet: https://faucet.circle.com/
 *    - Base Sepolia testnet USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 * 3. npm run dev でサーバーを起動してからこのスクリプトを実行
 *
 * Usage: npx tsx scripts/test_payment.ts
 */
import 'dotenv/config'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client'

const BASE_URL = `http://localhost:${process.env.PORT ?? 3000}`
const ENDPOINT = '/v1/wages/real?from=2015-01&to=2015-06&industry=ALL'

// 秘密鍵の確認
const rawKey = process.env.TEST_WALLET_PRIVATE_KEY
const privateKey = rawKey
  ? (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
  : undefined
if (!privateKey) {
  console.error('ERROR: TEST_WALLET_PRIVATE_KEY が .env に設定されていません')
  console.error('  例: TEST_WALLET_PRIVATE_KEY=0xあなたのBase Sepoliaテストウォレット秘密鍵')
  console.error('')
  console.error('テストUSDC取得先: https://faucet.circle.com/')
  console.error('  ネットワーク: Base Sepolia (Chain ID: 84532)')
  console.error('  USDC address: 0x036CbD53842c5426634e7929541eC2318f3dCF7e')
  process.exit(1)
}

console.log('=== x402 Payment End-to-End Test ===')
console.log(`Server: ${BASE_URL}`)
console.log(`Endpoint: ${ENDPOINT}`)
console.log()

// viemウォレットクライアントを作成
// createPaymentHeader は LocalAccount(isAccount) または WalletClient(isSignerWallet) を受け付ける
// WalletClient は chain + transport を持つため isSignerWallet を満たす
const account = privateKeyToAccount(privateKey)
console.log(`Wallet address: ${account.address}`)

const signer = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
}).extend(publicActions)

// Step 1: 支払いなしでリクエスト → 402を期待
console.log('\n[Step 1] Requesting without payment...')
const res1 = await fetch(`${BASE_URL}${ENDPOINT}`)
console.log(`  Status: ${res1.status}`)
if (res1.status !== 402) {
  console.error('  FAILED: Expected 402')
  process.exit(1)
}

const body402 = await res1.json() as {
  x402Version: number
  accepts: Array<{
    scheme: string
    network: string
    maxAmountRequired: string
    asset: string
    payTo: string
    description: string
    resource: string
    mimeType: string
    maxTimeoutSeconds: number
    extra: Record<string, string>
  }>
}
console.log('  402 response received ✓')
console.log(`  x402Version: ${body402.x402Version}`)
console.log(`  Payment required: ${parseInt(body402.accepts[0].maxAmountRequired) / 1_000_000} USDC`)
console.log(`  Pay to: ${body402.accepts[0].payTo}`)
console.log(`  Network: ${body402.accepts[0].network}`)

// Step 2: 支払いヘッダーを生成
console.log('\n[Step 2] Creating payment header...')
const paymentRequirements = selectPaymentRequirements(body402.accepts)

let paymentHeader: string
try {
  paymentHeader = await createPaymentHeader(signer, body402.x402Version, paymentRequirements)
  console.log(`  Payment header created ✓ (${paymentHeader.length} bytes base64)`)
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`  FAILED: ${msg}`)
  if (msg.includes('insufficient') || msg.includes('balance')) {
    console.error('\n  → ウォレットのUSDC残高が不足しています')
    console.error('  → https://faucet.circle.com/ でBase Sepolia USDCを取得してください')
  }
  process.exit(1)
}

// Step 3: 支払いヘッダー付きで再リクエスト
console.log('\n[Step 3] Requesting with payment header...')
const res2 = await fetch(`${BASE_URL}${ENDPOINT}`, {
  headers: { 'X-PAYMENT': paymentHeader },
})
console.log(`  Status: ${res2.status}`)

if (res2.status !== 200) {
  const errBody = await res2.text()
  console.error(`  FAILED: Expected 200, got ${res2.status}`)
  console.error(`  Body: ${errBody}`)
  process.exit(1)
}

const data = await res2.json() as {
  data: Array<{ date: string; industry_code: string; value: number }>
  meta: { count: number; base_year: number }
}

console.log('  200 OK ✓')
console.log(`\n=== RESULT ===`)
console.log(`Records received: ${data.meta.count}`)
console.log(`Base year: ${data.meta.base_year}`)
console.log('Sample data:')
for (const row of data.data.slice(0, 3)) {
  console.log(`  ${row.date} | ${row.industry_code} | ${row.value}`)
}

console.log('\n✓ x402 payment flow completed successfully!')
