import { clsx } from 'clsx'

interface Props {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'
  dot?: boolean
  className?: string
}

const map = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger:  'bg-red-100 text-red-700',
  info:    'bg-blue-100 text-blue-700',
  purple:  'bg-violet-100 text-violet-700',
}

const dotMap = {
  default: 'bg-gray-400',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  info:    'bg-blue-500',
  purple:  'bg-violet-500',
}

export default function Badge({ children, variant = 'default', dot, className }: Props) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
      map[variant], className,
    )}>
      {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', dotMap[variant])} />}
      {children}
    </span>
  )
}
