/**
 * Compact phase badge used in PluginCard
 */
import { clsx } from 'clsx'
import { type PolicyPhase } from '../../../types/policy.ts'

const PHASE_SHORT: Record<PolicyPhase, string> = {
  PRE_REQUEST:   'Pre-Req',
  POST_REQUEST:  'Post-Req',
  PRE_RESPONSE:  'Pre-Res',
  POST_RESPONSE: 'Post-Res',
}

const PHASE_TAG_COLOR: Record<PolicyPhase, string> = {
  PRE_REQUEST:   'bg-blue-50   text-blue-600   border-blue-200',
  POST_REQUEST:  'bg-green-50  text-green-600  border-green-200',
  PRE_RESPONSE:  'bg-purple-50 text-purple-600 border-purple-200',
  POST_RESPONSE: 'bg-orange-50 text-orange-600 border-orange-200',
}

interface Props {
  phase: PolicyPhase
  className?: string
}

export default function PhaseTag({ phase, className }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
        PHASE_TAG_COLOR[phase],
        className,
      )}
    >
      {PHASE_SHORT[phase]}
    </span>
  )
}
