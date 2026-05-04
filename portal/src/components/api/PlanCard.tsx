import { CheckCircle2 } from 'lucide-react'
import Card from '@/components/ui/Card'
import SubscribeButton from './SubscribeButton'

interface Plan {
  id:           string
  name:         string
  description:  string | null
  isFree:       boolean
  price?:       number
  rateLimit:    { rpm: number; rph: number; rpd: number } | null
  quotaLimit:   { daily: number; monthly: number } | null
}

interface Props {
  plan:        Plan
  isLoggedIn:  boolean
  alreadySub:  boolean
  featured?:   boolean
}

export default function PlanCard({ plan, isLoggedIn, alreadySub, featured }: Props) {
  const features: string[] = []
  if (plan.rateLimit?.rpm) features.push(`${plan.rateLimit.rpm.toLocaleString()} RPM`)
  if (plan.rateLimit?.rpd) features.push(`${plan.rateLimit.rpd.toLocaleString()} RPD`)
  if (plan.quotaLimit?.monthly) features.push(`${plan.quotaLimit.monthly.toLocaleString()} 次/月`)
  if (plan.isFree)  features.push('永久免費')

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
        {plan.isFree ? (
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

      <SubscribeButton plan={plan} isLoggedIn={isLoggedIn} alreadySubbed={alreadySub} />
    </Card>
  )
}
