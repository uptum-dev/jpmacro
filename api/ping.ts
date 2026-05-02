export const config = { runtime: 'nodejs' }

export default function handler() {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
