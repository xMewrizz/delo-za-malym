import { queryOptions } from '@tanstack/react-query'
import { getProducts } from '../api/products'

export const productQueries = {
  list: () => queryOptions({
    queryKey: ['products'],
    queryFn: ({ signal }) => getProducts(signal),
  }),
}
