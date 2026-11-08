import { PRODUCT_CATEGORIES, type ProductCategory } from "@chicman/shared"

import { catalogApiPath, NO_FILTERS, type CatalogFilters } from "./catalog-query"

export const NEWEST_COUNT = 8
const CATEGORY_COUNT = 4

export interface HomeSection {
  id: "newest" | ProductCategory
  filters: CatalogFilters
  path: string
}

function section(id: HomeSection["id"], filters: CatalogFilters, pageSize: number): HomeSection {
  return { id, filters, path: catalogApiPath(filters, pageSize) }
}

export const HOME_SECTIONS: readonly HomeSection[] = [
  section("newest", NO_FILTERS, NEWEST_COUNT),
  ...PRODUCT_CATEGORIES.map((category) => section(category, { ...NO_FILTERS, category }, CATEGORY_COUNT)),
]
