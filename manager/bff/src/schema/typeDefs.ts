import { gql } from 'graphql-tag'

export const typeDefs = gql`
  # ─── Scalars ──────────────────────────────────────────────────
  scalar DateTime
  scalar JSON

  # ─── Enums ────────────────────────────────────────────────────
  enum UserRole {
    SUPER_ADMIN
    ORG_ADMIN
    DEVELOPER
    VIEWER
  }

  enum APIStatus {
    DRAFT
    ACTIVE
    DEPRECATED
    ARCHIVED
  }

  enum SubscriptionStatus {
    PENDING
    ACTIVE
    SUSPENDED
    EXPIRED
    CANCELLED
  }

  enum APIKeyStatus {
    ACTIVE
    REVOKED
    EXPIRED
  }

  enum PolicyPhase {
    PRE_REQUEST
    POST_REQUEST
    PRE_RESPONSE
    POST_RESPONSE
  }

  # ─── Pagination ────────────────────────────────────────────────
  type PageInfo {
    page:       Int!
    limit:      Int!
    total:      Int!
    totalPages: Int!
    hasNext:    Boolean!
    hasPrev:    Boolean!
  }

  # ─── User / Org ────────────────────────────────────────────────
  type User {
    id:        ID!
    email:     String!
    name:      String!
    role:      UserRole!
    orgId:     ID
    org:       Organization
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Organization {
    id:          ID!
    name:        String!
    slug:        String!
    description: String
    createdAt:   DateTime!
    updatedAt:   DateTime!
    apis(page: Int, limit: Int): APIConnection!
    subscriptions(status: SubscriptionStatus, page: Int, limit: Int): SubscriptionConnection!
  }

  # ─── API Registry ──────────────────────────────────────────────
  type API {
    id:             ID!
    name:           String!
    version:        String!
    basePath:       String!
    upstreamUrl:    String!
    description:    String
    status:         APIStatus!
    orgId:          ID!
    org:            Organization
    tags:           [String!]!
    timeoutMs:      Int!
    retries:        Int!
    stripBasePath:  Boolean!
    policyChain:    PolicyChain
    createdAt:      DateTime!
    updatedAt:      DateTime!
  }

  type APIConnection {
    nodes:    [API!]!
    pageInfo: PageInfo!
  }

  # ─── Plans ─────────────────────────────────────────────────────
  type Plan {
    id:          ID!
    name:        String!
    description: String
    rpmLimit:    Int!
    rpdLimit:    Int!
    rphLimit:    Int!
    maxKeys:     Int!
    price:       Float!
    currency:    String!
    features:    [String!]!
    isPublic:    Boolean!
    createdAt:   DateTime!
  }

  # ─── Subscription ──────────────────────────────────────────────
  type Subscription {
    id:         ID!
    orgId:      ID!
    org:        Organization
    planId:     ID!
    plan:       Plan
    apiId:      ID!
    api:        API
    status:     SubscriptionStatus!
    expiresAt:  DateTime
    createdAt:  DateTime!
    updatedAt:  DateTime!
    apiKeys(status: APIKeyStatus): [APIKey!]!
  }

  type SubscriptionConnection {
    nodes:    [Subscription!]!
    pageInfo: PageInfo!
  }

  # ─── API Keys ──────────────────────────────────────────────────
  type APIKey {
    id:             ID!
    keyId:          String!
    keyPrefix:      String!
    plainKey:       String
    subscriptionId: ID!
    subscription:   Subscription
    name:           String!
    status:         APIKeyStatus!
    allowedIps:     [String!]!
    allowedOrigins: [String!]!
    scopes:         [String!]!
    expiresAt:      DateTime
    lastUsedAt:     DateTime
    createdAt:      DateTime!
  }

  # ─── Policy Engine ─────────────────────────────────────────────
  type PolicyChain {
    chainId:  ID!
    apiId:    ID!
    version:  Int!
    etag:     String!
    policies: [Policy!]!
    updatedAt: DateTime
  }

  type Policy {
    id:        ID!
    type:      String!
    phase:     PolicyPhase!
    order:     Int!
    enabled:   Boolean!
    config:    JSON!
    condition: String
  }

  # ─── Analytics Summary ─────────────────────────────────────────
  type APIMetrics {
    apiId:          ID!
    period:         String!
    totalRequests:  Int!
    errorRequests:  Int!
    errorRate:      Float!
    avgLatencyMs:   Float!
    p99LatencyMs:   Float!
    topStatusCodes: [StatusCodeCount!]!
  }

  type StatusCodeCount {
    statusCode: Int!
    count:      Int!
  }

  # ─── Mutations input types ─────────────────────────────────────
  input CreateOrganizationInput {
    name:        String!
    slug:        String!
    description: String
  }

  input CreateAPIInput {
    name:          String!
    version:       String!
    basePath:      String!
    upstreamUrl:   String!
    description:   String
    orgId:         ID!
    tags:          [String!]
    timeoutMs:     Int
    retries:       Int
    stripBasePath: Boolean
  }

  input UpdateAPIInput {
    name:          String
    upstreamUrl:   String
    description:   String
    status:        APIStatus
    tags:          [String!]
    timeoutMs:     Int
    retries:       Int
    stripBasePath: Boolean
  }

  input CreatePlanInput {
    name:        String!
    description: String
    rpmLimit:    Int!
    rpdLimit:    Int!
    rphLimit:    Int
    maxKeys:     Int!
    price:       Float!
    currency:    String
    features:    [String!]
    isPublic:    Boolean
  }

  input CreateSubscriptionInput {
    orgId:     ID!
    planId:    ID!
    apiId:     ID!
    expiresAt: DateTime
  }

  input CreateAPIKeyInput {
    subscriptionId: ID!
    name:           String!
    allowedIps:     [String!]
    allowedOrigins: [String!]
    scopes:         [String!]
    expiresAt:      DateTime
  }

  input PolicyInput {
    type:      String!
    phase:     PolicyPhase!
    order:     Int!
    enabled:   Boolean!
    config:    JSON!
    condition: String
  }

  input PublishPolicyChainInput {
    policies: [PolicyInput!]!
  }

  # ─── Root types ────────────────────────────────────────────────
  type Query {
    me:           User!

    organizations(page: Int, limit: Int, search: String): [Organization!]!
    organization(id: ID!): Organization

    apis(orgId: ID, status: APIStatus, page: Int, limit: Int): APIConnection!
    api(id: ID!): API

    plans(isPublic: Boolean): [Plan!]!
    plan(id: ID!): Plan

    subscriptions(
      orgId:  ID
      apiId:  ID
      status: SubscriptionStatus
      page:   Int
      limit:  Int
    ): SubscriptionConnection!
    subscription(id: ID!): Subscription

    apiKeys(subscriptionId: ID!): [APIKey!]!
    apiKey(id: ID!): APIKey

    policyChain(apiId: ID!): PolicyChain
  }

  type Mutation {
    createOrganization(input: CreateOrganizationInput!): Organization!
    updateOrganization(id: ID!, input: CreateOrganizationInput!): Organization!
    deleteOrganization(id: ID!): Boolean!

    createAPI(input: CreateAPIInput!): API!
    updateAPI(id: ID!, input: UpdateAPIInput!): API!
    deleteAPI(id: ID!): Boolean!

    createPlan(input: CreatePlanInput!): Plan!
    updatePlan(id: ID!, input: CreatePlanInput!): Plan!
    deletePlan(id: ID!): Boolean!

    createSubscription(input: CreateSubscriptionInput!): Subscription!
    updateSubscriptionStatus(id: ID!, status: SubscriptionStatus!): Subscription!
    cancelSubscription(id: ID!): Subscription!

    createAPIKey(input: CreateAPIKeyInput!): APIKey!
    revokeAPIKey(subscriptionId: ID!, id: ID!): Boolean!

    publishPolicyChain(apiId: ID!, input: PublishPolicyChainInput!): PolicyChain!
    invalidatePolicyCache(apiId: ID!): Boolean!
  }
`
