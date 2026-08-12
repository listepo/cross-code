import { EventData, Page } from '@nativescript/core'
import { WidgetsGalleryModel } from './main-view-model'

export function navigatingTo(args: EventData) {
  const page = <Page>args.object
  page.bindingContext = new WidgetsGalleryModel()
}
