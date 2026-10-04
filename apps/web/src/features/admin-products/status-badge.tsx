import { useT } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import type { ProductStatus } from './api'

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const t = useT()
  const variant = status === 'ACTIVE' ? 'default' : status === 'HIDDEN' ? 'secondary' : 'outline'
  return <Badge variant={variant}>{t(`admin.products.status.${status}`)}</Badge>
}
