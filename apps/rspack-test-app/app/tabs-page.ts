import { EventData, View } from '@nativescript/core'

export function onClose(args: EventData) {
  const page = (args.object as View).page
  // shown modally => no frame to go back to
  if (page.frame) {
    page.frame.goBack()
  } else {
    page.closeModal()
  }
}
