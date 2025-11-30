export type InventoryItem = {
  inventory_id: number | null
  quantity_on_hand: number
  location: string
  reorder_level: number
  on_order_quantity?: number
  required_for_orders?: number | null
  component: {
    component_id: number
    internal_code: string
    description: string
    image_url: string | null
    category: {
      cat_id: number
      categoryname: string
    }
    unit: {
      unit_id: number
      unit_name: string
    }
  }
  supplierComponents?: Array<{
    supplier_id: number
    supplier_code: string
    price: number
    supplier: {
      name: string
    }
  }>
} 