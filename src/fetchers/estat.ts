const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData'

export interface EstatValue {
  /** e-Stat "@area", "@time", "@cat01" etc. codes */
  [key: string]: string
  $: string   // actual value string (may end with "p" for preliminary)
}

interface EstatResponse {
  GET_STATS_DATA: {
    STATISTICAL_DATA: {
      DATA_INF: {
        VALUE: EstatValue | EstatValue[]
      }
      TABLE_INF: {
        NEXT_KEY?: number
      }
    }
  }
}

export async function fetchEstatAll(statsDataId: string): Promise<EstatValue[]> {
  const apiKey = process.env.ESTAT_API_KEY
  if (!apiKey) throw new Error('ESTAT_API_KEY is not set')

  const results: EstatValue[] = []
  let startPosition: number | undefined

  while (true) {
    const url = new URL(ESTAT_BASE)
    url.searchParams.set('appId', apiKey)
    url.searchParams.set('statsDataId', statsDataId)
    url.searchParams.set('limit', '10000')
    if (startPosition !== undefined) {
      url.searchParams.set('startPosition', String(startPosition))
    }

    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`e-Stat HTTP ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as EstatResponse
    const stat = json.GET_STATS_DATA?.STATISTICAL_DATA
    if (!stat) throw new Error('Unexpected e-Stat response shape')

    const raw = stat.DATA_INF?.VALUE
    const values = Array.isArray(raw) ? raw : raw ? [raw] : []
    results.push(...values)

    const nextKey = stat.TABLE_INF?.NEXT_KEY
    if (!nextKey) break
    startPosition = nextKey
  }

  return results
}
