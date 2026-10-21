import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { apiRequest } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('API boundary', () => {
  const schema = z.object({ amount: z.string() })

  it('preserves decimal strings and validates successful responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"amount":"500000.00"}'))
    vi.stubGlobal('fetch', fetch)
    await expect(apiRequest('/example', schema)).resolves.toEqual({ amount: '500000.00' })
    expect(fetch.mock.calls[0][0]).toBe('/api/example')
  })

  it('rejects a response whose shape no longer matches the API contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"amount":500000}')))
    await expect(apiRequest('/example', schema)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('preserves conflict details and never repeats a mutation automatically', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: 'version_conflict', message: 'Версия заявки изменилась.' },
    }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    await expect(apiRequest('/example', schema, { method: 'PATCH', body: '{}' }))
      .rejects.toMatchObject({ status: 409, code: 'version_conflict', message: 'Версия заявки изменилась.' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('handles FastAPI validation arrays without showing raw internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: [{ loc: ['body', 'need'], msg: 'Field required' }],
    }), { status: 422 })))
    await expect(apiRequest('/example', schema)).rejects.toMatchObject({
      status: 422, message: 'Проверьте заполненные поля.',
    })
  })

  it('turns an HTML proxy failure into an API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })))
    await expect(apiRequest('/example', schema)).rejects.toMatchObject({ name: 'ApiError', status: 502 })
  })

  it('forwards query cancellation to fetch', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    })))
    const pending = apiRequest('/example', schema, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
