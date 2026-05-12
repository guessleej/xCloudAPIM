'use client'
import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import { CREATE_SUBSCRIPTION } from '@/lib/graphql/mutations'
import Button from '@/components/ui/Button'

interface Plan {
  id:    string
  name:  string
  price?: number
}

interface Props {
  plan:          Plan
  apiId:         string
  orgId:         string
  isLoggedIn:    boolean
  alreadySubbed: boolean
}

export default function SubscribeButton({ plan, apiId, orgId, isLoggedIn, alreadySubbed }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [done, setDone] = useState(alreadySubbed)

  const [createSubscription, { loading, error }] = useMutation(CREATE_SUBSCRIPTION, {
    onCompleted: () => {
      setDone(true)
      setShowForm(false)
      router.push('/dashboard/subscriptions')
    },
  })

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
        <CheckCircle size={16} /> 已訂閱
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <Button variant="outline" size="sm" onClick={() => router.push('/auth/login?next=' + window.location.pathname)}>
        登入以訂閱
      </Button>
    )
  }

  return (
    <div>
      {!showForm ? (
        <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
          訂閱 {plan.name}
        </Button>
      ) : (
        <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-200 space-y-2">
          <p className="text-xs font-medium text-blue-800">確認建立這個 API 的訂閱</p>
          {error && <p className="text-xs text-red-600">{error.message}</p>}
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="primary"
              loading={loading}
              disabled={!orgId}
              onClick={() => createSubscription({ variables: { input: { orgId, apiId, planId: plan.id } } })}
            >
              確認訂閱
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setShowForm(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
