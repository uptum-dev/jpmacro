import type { MiddlewareHandler } from 'hono'

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator'
const NETWORK = process.env.X402_NETWORK ?? 'base-sepolia'
const MAX_TIMEOUT = 300

const walletAddress = process.env.X402_WALLET_ADDRESS
if (!walletAddress) throw new Error('X402_WALLET_ADDRESS is not set')

// USDC on Base Sepolia / Base Mainnet
const USDC_ADDRESS =
  NETWORK === 'base' || NETWORK === 'eip155:8453'
    ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    : '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

function usdcAmount(dollars: number): string {
  return String(Math.round(dollars * 1_000_000))
}

function buildPaymentRequired(url: string, description: string, amountUsd: number) {
  return {
    x402Version: 1,
    error: 'Payment required',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: usdcAmount(amountUsd),
        resource: url,
        description,
        mimeType: 'application/json',
        payTo: walletAddress,
        maxTimeoutSeconds: MAX_TIMEOUT,
        asset: USDC_ADDRESS,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  }
}

async function verifyAndSettle(
  paymentHeader: string,
  url: string,
  description: string,
  amountUsd: number,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  let paymentPayload: unknown
  try {
    paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'))
  } catch {
    return { ok: false, error: 'Invalid payment header encoding' }
  }

  const paymentRequirements = {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: usdcAmount(amountUsd),
    resource: url,
    description,
    mimeType: 'application/json',
    payTo: walletAddress,
    maxTimeoutSeconds: MAX_TIMEOUT,
    asset: USDC_ADDRESS,
    extra: { name: 'USDC', version: '2' },
  }

  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  })
  if (!verifyRes.ok) {
    const body = await verifyRes.text().catch(() => '')
    return { ok: false, error: `Facilitator verify failed: ${verifyRes.status} ${body}` }
  }
  const verifyResult = (await verifyRes.json()) as { isValid: boolean; invalidReason?: string }
  if (!verifyResult.isValid) {
    return { ok: false, error: verifyResult.invalidReason ?? 'Payment invalid' }
  }

  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  })
  if (!settleRes.ok) {
    return { ok: false, error: `Facilitator settle failed: ${settleRes.status}` }
  }
  const settleResult = (await settleRes.json()) as {
    success: boolean
    transaction?: string
    error?: string
  }
  if (!settleResult.success) {
    return { ok: false, error: settleResult.error ?? 'Settlement failed' }
  }

  return { ok: true, txHash: settleResult.transaction }
}

export function paywall(description: string, amountUsd: number): MiddlewareHandler {
  return async (c, next) => {
    const paymentHeader = c.req.header('X-PAYMENT')

    if (!paymentHeader) {
      const url = c.req.url.replace(/^http:\/\//, 'https://')
      return c.json(buildPaymentRequired(url, description, amountUsd), 402)
    }

    const result = await verifyAndSettle(
      paymentHeader,
      c.req.url.replace(/^http:\/\//, 'https://'),
      description,
      amountUsd,
    )

    if (!result.ok) {
      return c.json({ error: result.error ?? 'Payment verification failed' }, 402)
    }

    c.set('x402TxHash', result.txHash ?? '')
    await next()
  }
}
