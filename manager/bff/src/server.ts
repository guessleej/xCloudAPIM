import http from 'node:http'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default'
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled'
import express from 'express'
import cors from 'cors'
import { typeDefs }   from './schema/typeDefs.js'
import { resolvers }  from './resolvers/index.js'
import { buildContext } from './context.js'
import { depthLimitPlugin } from './plugins/depth-limit.js'
import { config }     from './config/index.js'
import type { Logger } from 'pino'
import type { BffContext } from './context.js'

export async function buildServer(log: Logger): Promise<http.Server> {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '2mb' }))

  // ─── Health check（不走 GraphQL）─────────────────────────────
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'bff' })
  })

  // ─── Apollo Server 4 ─────────────────────────────────────────
  const apollo = new ApolloServer<BffContext>({
    typeDefs,
    resolvers,
    introspection: config.INTROSPECTION_ENABLED,
    plugins: [
      depthLimitPlugin(config.GRAPHQL_MAX_DEPTH),
      config.NODE_ENV === 'production'
        ? ApolloServerPluginLandingPageDisabled()
        : ApolloServerPluginLandingPageLocalDefault({ embed: true }),
    ],
    formatError(formattedError, err) {
      log.warn({ err, formattedError }, 'GraphQL error')
      // 生產環境不洩漏 stack trace
      if (config.NODE_ENV === 'production') {
        const { extensions } = formattedError
        return {
          message:    formattedError.message,
          extensions: {
            code: extensions?.['code'] ?? 'INTERNAL_SERVER_ERROR',
          },
        }
      }
      return formattedError
    },
  })

  await apollo.start()

  app.use(
    config.GRAPHQL_PATH,
    expressMiddleware(apollo, {
      context: async ({ req }) => {
        const authHeader = req.headers.authorization as string | undefined
        return buildContext(authHeader, log)
      },
    }),
  )

  return http.createServer(app)
}
