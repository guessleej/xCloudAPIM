import { clsx } from 'clsx'

interface Props {
  children:  React.ReactNode
  className?: string
  hover?:     boolean
  padding?:   'none' | 'sm' | 'md' | 'lg'
}

export default function Card({ children, className, hover, padding = 'md' }: Props) {
  const paddings = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' }
  return (
    <div className={clsx(
      'bg-white rounded-2xl border border-gray-200 shadow-sm',
      hover && 'transition-shadow hover:shadow-md',
      paddings[padding],
      className,
    )}>
      {children}
    </div>
  )
}
