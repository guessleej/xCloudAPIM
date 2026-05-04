'use client'
import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { CANCEL_SUBSCRIPTION } from '@/lib/graphql/mutations'
import Button from '@/components/ui/Button'

export default function CancelSubscriptionButton({ subscriptionId }: { subscriptionId: string }) {
  const router   = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [cancel, { loading }] = useMutation(CANCEL_SUBSCRIPTION, {
    variables:   { id: subscriptionId },
    onCompleted: () => router.refresh(),
  })

  if (!confirm) {
    return (
      <Button variant="ghost" size="xs"
        className="text-red-500 hover:text-red-700 hover:bg-red-50"
        onClick={() => setConfirm(true)}>
        取消訂閱
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500">確定取消？</span>
      <Button variant="danger" size="xs" loading={loading} onClick={() => cancel()}>確定</Button>
      <Button variant="ghost" size="xs" onClick={() => setConfirm(false)}>取消</Button>
    </div>
  )
}
