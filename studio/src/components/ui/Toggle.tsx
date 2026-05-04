import { clsx } from 'clsx'

interface Props {
  checked:  boolean
  onChange: (v: boolean) => void
  label?:   string
  disabled?: boolean
}

export default function Toggle({ checked, onChange, label, disabled }: Props) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500',
          checked ? 'bg-blue-600' : 'bg-gray-300',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className={clsx(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4',
        )} />
      </button>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  )
}
