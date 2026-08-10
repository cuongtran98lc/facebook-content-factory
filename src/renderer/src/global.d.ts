import type { ContentFactoryAPI } from '../../shared/types'

declare global {
  interface Window {
    contentFactory: ContentFactoryAPI
  }
}
export {}
