import {
  BookOpen,
  Bot,
  Calculator,
  CircleDot,
  History,
  LifeBuoy,
  type LucideIcon,
  Mail,
  PhoneCall,
  Search,
  Tags,
  UserCheck,
  Users,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  classify: Tags,
  recall_history: History,
  search_kb: BookOpen,
  get_price_list: Calculator,
  crm_lookup: Search,
  search_crm: Search,
  draft_quote: Calculator,
  crm_upsert: Users,
  send_email: Mail,
  request_callback: PhoneCall,
  human_review: UserCheck,
  desk_fallback: LifeBuoy,
}

export function StepIcon({ tool }: { tool: string | null | undefined }) {
  const Icon = (tool && ICONS[tool]) || (tool ? Bot : CircleDot)
  return <Icon aria-hidden="true" />
}
