/**
 * Shows how many times a plugin type is used in the current chain
 */
import { clsx } from 'clsx'

interface Props {
  count: number
  className?: string
}

export default function UsageBadge({ count, className }: Props) {
  if (count === 0) return null
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1',
        'rounded-full text-[10px] font-semibold',
        'bg-blue-600 text-white',
        className,
      )}
      title={`已在此鏈中使用 ${count} 次`}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
