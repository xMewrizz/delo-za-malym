import type { ZodType } from 'zod'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
export const apiUrl = (path: `/${string}`) => `${baseUrl}${path}`

/** Validate responses at the network boundary; feature APIs own their schemas. */
export async function apiRequest<T>(
  path: `/${string}`,
  schema: ZodType<T>,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, ...requestOptions } = options
  const headers = new Headers(requestOptions.headers)
  headers.set('Accept', 'application/json')
  if (requestOptions.body && !(requestOptions.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeout]) : timeout
  const response = await fetch(`${baseUrl}${path}`, { ...requestOptions, headers, signal })
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = isRecord(payload) && isRecord(payload.detail) ? payload.detail : null
    const message = typeof detail?.message === 'string' ? detail.message :
      response.status === 422 ? 'Проверьте заполненные поля.' :
      response.status === 409 ? 'Данные изменились. Загрузите актуальную версию.' :
      'Не удалось выполнить запрос. Попробуйте ещё раз.'
    throw new ApiError(message, response.status,
      typeof detail?.code === 'string' ? detail.code : undefined)
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError('Сервер вернул данные в неожиданном формате.', response.status, 'invalid_response')
  }
  return parsed.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.name === 'TimeoutError') return 'Сервер долго не отвечает. Попробуйте ещё раз.'
  return 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.'
}
