import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchEffectiveBOM } from '@/lib/db/quotes'

test('fetchEffectiveBOM requests base route without options', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl: string | undefined

  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return new Response(JSON.stringify({ items: [{ component_id: 1, quantity_required: 2 }] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await fetchEffectiveBOM(55)
    assert.strictEqual(requestedUrl, '/api/products/55/effective-bom')
    assert.deepEqual(result, [{ component_id: 1, quantity_required: 2 }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchEffectiveBOM serializes selected options into the query string', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl: string | undefined

  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    requestedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return new Response(JSON.stringify({ items: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const options = { HS: 'BOWH' }

  try {
    await fetchEffectiveBOM(55, options)
    assert.ok(requestedUrl)
    const url = new URL(requestedUrl!, 'http://localhost')
    assert.strictEqual(url.pathname, '/api/products/55/effective-bom')
    assert.strictEqual(url.searchParams.get('selected_options'), JSON.stringify(options))
  } finally {
    globalThis.fetch = originalFetch
  }
})
