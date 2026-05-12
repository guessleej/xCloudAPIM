import { CheckCircle2 } from 'lucide-react'
import Card from '@/components/ui/Card'
import SubscribeButton from './SubscribeButton'

interface Plan {
  id:           string
  name:         string
  description:  string | null
  isPublic:     boolean
  price?:       number
  rpmLimit:     number
  rphLimit:     number
  rpdLimit:     number
}

interface Props {
  plan:        Plan
  apiId:       string
  orgId:       string
  isLoggedIn:  boolean
  alreadySub:  boolean
  featured?:   boolean
}

export default function PlanCard({ plan, apiId, orgId, isLoggedIn, alreadySub, featured }: Props) {
  const features: string[] = []
  if (plan.rpmLimit) features.push(`${plan.rpmLimit.toLocaleString()} RPM`)
  if (plan.rphLimit) features.push(`${plan.rphLimit.toLocaleString()} RPH`)
  if (plan.rpdLimit) features.push(`${plan.rpdLimit.toLocaleString()} RPD`)
  if (!plan.price) features.push('永久免費')

  return (
    <Card
      className={featured ? 'border-brand-500 ring-2 ring-brand-200' : ''}
      padding="lg"
    >
      {featured && (
        <div className="text-xs font-semibold text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full w-fit mb-3">
          推薦方案
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
        {plan.description && (
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{plan.description}</p>
        )}
      </div>

      <div className="mb-5">
        {!plan.price ? (
          <span className="text-3xl font-bold text-gray-900">免費</span>
        ) : (
          <div>
            <span className="text-3xl font-bold text-gray-900">
              ${plan.price?.toLocaleString() ?? '—'}
            </span>
            <span className="text-sm text-gray-400 ml-1">/月</span>
          </div>
        )}
      </div>

      <ul className="space-y-2 mb-6">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
            <CheckCircle2 size={15} className="text-green-500 shrink-0" />
            {f}
          </li>
        ))}
      </ul>

      <SubscribeButton plan={plan} apiId={apiId} orgId={orgId} isLoggedIn={isLoggedIn} alreadySubbed={alreadySub} />
    </Card>
  )
}
