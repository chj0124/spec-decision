import type { Sku } from '../../lib/types'
import { uid } from '../../lib/engine'

export const emptySku = (): Sku => ({
  id: uid(), name: '', price: 0, quantity: 0, unit: 'g', packs: 1,
})
