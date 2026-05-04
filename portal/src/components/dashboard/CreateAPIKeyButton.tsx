'use client'
import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { Plus, Key } from 'lucide-react'
import { CREATE_API_KEY } from '@/lib/graphql/mutations'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

interface Props {
  subscriptionId: string
  primary?: boolean
}

export default function CreateAPIKeyButton({ subscriptionId, primary }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [createKey, { loading }] = useMutation(CREATE_API_KEY, {
    onCompleted: () => {
      setOpen(false)
      setName('')
      router.refresh()
    },
    onError: (err) => setError(err.message),
  })

  return (
    <>
      <Button
        variant={primary ? 'primary' : 'outline'}
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus size={14} /> 建立 API Key
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm p-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Key size={18} className="text-brand-600" />
              <h3 className="font-bold text-gray-900">建立 API Key</h3>
            </div>

            <div className="space-y-4">
              <Input
                label="金鑰名稱（方便識別）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：Production, iOS App"
                autoFocus
              />
              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="primary"
                fullWidth
                loading={loading}
                disabled={!name.trim()}
                onClick={() => createKey({ variables: { subscriptionId, name: name.trim() } })}
              >
                建立
              </Button>
              <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
