import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildASTSchema, isObjectType } from 'graphql'
import { typeDefs } from './typeDefs.js'

describe('BFF schema contract', () => {
  const schema = buildASTSchema(typeDefs)

  it('exposes the API catalog contract used by portal and gateway flows', () => {
    const query = schema.getQueryType()
    assert.ok(query)

    const fields = query.getFields()
    assert.ok(fields['apis'])
    assert.ok(fields['api'])
    assert.ok(fields['subscriptions'])
    assert.ok(fields['apiKeys'])
  })

  it('keeps APIConnection.pageInfo available for portal pagination', () => {
    const apiConnection = schema.getType('APIConnection')
    assert.ok(isObjectType(apiConnection))
    assert.ok(apiConnection.getFields()['nodes'])
    assert.ok(apiConnection.getFields()['pageInfo'])
  })
})
