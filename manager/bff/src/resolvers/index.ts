import { DateTimeScalar, JSONScalar } from './scalars.js'
import { userResolvers }         from './user.js'
import { apiResolvers }          from './api.js'
import { subscriptionResolvers } from './subscription.js'
import { policyResolvers }       from './policy.js'

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON:     JSONScalar,

  Query: {
    ...userResolvers.Query,
    ...apiResolvers.Query,
    ...subscriptionResolvers.Query,
    ...policyResolvers.Query,
  },

  Mutation: {
    ...userResolvers.Mutation,
    ...apiResolvers.Mutation,
    ...subscriptionResolvers.Mutation,
    ...policyResolvers.Mutation,
  },

  // Object-type field resolvers
  User:         userResolvers.User,
  Organization: userResolvers.Organization,
  API:          apiResolvers.API,
  Subscription: subscriptionResolvers.Subscription,
  APIKey:       subscriptionResolvers.APIKey,
}
