/**
 * Lucide icon lookup for plugin types — keeps policy.ts free of React imports
 */
import {
  ShieldCheck, Gauge, Globe, Shield,
  ArrowLeftRight, Layers, ToggleLeft,
  type LucideProps,
} from 'lucide-react'

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  ShieldCheck,
  Gauge,
  Globe,
  Shield,
  ArrowLeftRight,
  Layers,
  ToggleLeft,
}

interface Props extends LucideProps {
  name: string
}

export default function PluginIcon({ name, ...props }: Props) {
  const Icon = ICON_MAP[name]
  if (!Icon) return null
  return <Icon {...props} />
}
