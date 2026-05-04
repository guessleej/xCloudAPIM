/**
 * Proxy OpenAPI spec from Registry Service
 * GET /api/spec/[apiId]  →  REGISTRY_SERVICE_URL/apis/[apiId]/spec
 */
import { NextRequest, NextResponse } from 'next/server'

const REGISTRY_URL =
  process.env.REGISTRY_SERVICE_URL ?? 'http://localhost:8082'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { apiId: string } },
) {
  const upstream = `${REGISTRY_URL}/apis/${params.apiId}/spec`

  try {
    const res = await fetch(upstream, {
      next: { revalidate: 30 },
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const spec = await res.json()

    // Inject servers block if missing (use portal's /graphql rewrite as base)
    if (!spec.servers || spec.servers.length === 0) {
      spec.servers = [{ url: spec.info?.['x-base-path'] ?? '/', description: 'API Gateway' }]
    }

    return NextResponse.json(spec, {
      headers: {
        'Cache-Control':                'public, s-maxage=30, stale-while-revalidate=60',
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: { apiId: string } },
) {
  const res = await GET(req, ctx)
  return new NextResponse(null, { status: res.status, headers: res.headers })
}
