import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import type { UserStatus } from './api'

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const t = useT()
  const variant = status === 'ACTIVE' ? 'default' : status === 'BLOCKED' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{t(`admin.users.status.${status}`)}</Badge>
}
