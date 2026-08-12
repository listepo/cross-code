import {
  Color,
  Frame,
  Label,
  Observable,
  ObservableArray,
  StackLayout,
  Utils,
  View,
  action,
  isAndroid,
  alert,
  confirm,
  getRootLayout,
  login,
  prompt,
} from '@nativescript/core'
import type { CreateViewEventData, EventData, GestureEventData, ItemEventData } from '@nativescript/core'

export class WidgetsGalleryModel extends Observable {
  // status
  message = 'Tap a widget to see it react'
  taps = 0

  // text input
  textFieldValue = 'Hello NativeScript'
  password = 's3cret'
  textViewValue = 'TextView holds multiple lines of editable text.'
  searchValue = ''

  // toggles / progress
  switchOn = true
  sliderValue = 40
  busy = true

  // pickers
  pickedDate = new Date()
  pickedTime = new Date()
  pickerItems = ['Alpha', 'Beta', 'Gamma', 'Delta']
  pickerIndex = 1
  segmentIndex = 0

  // items
  listItems = new ObservableArray([
    { name: 'ListView row 1', detail: 'templated' },
    { name: 'ListView row 2', detail: 'observable' },
    { name: 'ListView row 3', detail: 'virtualized' },
    { name: 'ListView row 4', detail: 'tappable' },
    { name: 'ListView row 5', detail: 'scrollable' },
  ])
  // $value on a primitive item is a boxed String, which colour properties can't parse — bind object props instead
  colors = ['#e91e63', '#9c27b0', '#3f51b5', '#009688', '#ff9800', '#795548'].map((hex) => ({ hex }))

  // web content
  htmlSnippet = '<h3 style="margin:0">HtmlView</h3><p>Renders a <b>native</b> <i>HTML</i> string.</p>'
  webViewSource =
    '<html><body style="font-family:-apple-system,sans-serif;margin:8px"><h3>WebView</h3><p>Full browser engine, local or remote content.</p></body></html>'
  remoteImage = 'https://raw.githubusercontent.com/NativeScript/artwork/main/logo/export/NativeScript_Logo_Blue_White.png'

  // gestures
  lastGesture = 'none yet'

  onTap() {
    this.set('taps', this.taps + 1)
    this.set('message', `Button tapped ${this.taps} time${this.taps === 1 ? '' : 's'}`)
  }

  onSearchSubmit(args: EventData) {
    this.set('message', `SearchBar submitted: ${(args.object as any).text}`)
  }

  onListItemTap(args: ItemEventData) {
    this.set('message', `ListView tapped: ${this.listItems.getItem(args.index).name}`)
  }

  onGesture(args: GestureEventData) {
    this.set('lastGesture', args.eventName)
  }

  onCreatingPlaceholderView(args: CreateViewEventData) {
    if (isAndroid) {
      const tv = new android.widget.TextView(Utils.android.getApplicationContext())
      tv.setText('Native android.widget.TextView')
      args.view = tv
    } else {
      const label = UILabel.new()
      label.text = 'Native UILabel'
      args.view = label
    }
  }

  onAnimate(args: EventData) {
    const box = (args.object as View).page.getViewById<View>('animBox')
    box
      .animate({ backgroundColor: new Color('#e91e63'), duration: 300 })
      .then(() => box.animate({ scale: { x: 1.4, y: 1.4 }, rotate: 180, duration: 400 }))
      .then(() => box.animate({ translate: { x: 60, y: 0 }, opacity: 0.4, duration: 300 }))
      .then(() =>
        box.animate({
          translate: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotate: 0,
          opacity: 1,
          backgroundColor: new Color('#1976d2'),
          duration: 400,
        }),
      )
  }

  onAlert() {
    alert({ title: 'alert()', message: 'A single-button dialog.', okButtonText: 'OK' })
  }

  onConfirm() {
    confirm({ title: 'confirm()', message: 'Two choices.', okButtonText: 'Yes', cancelButtonText: 'No' }).then((result) =>
      this.set('message', `confirm() → ${result}`),
    )
  }

  onPrompt() {
    prompt({ title: 'prompt()', message: 'Type something', okButtonText: 'OK', cancelButtonText: 'Cancel', defaultText: 'NativeScript' }).then(
      (result) => this.set('message', `prompt() → ${result.text} (${result.result})`),
    )
  }

  onAction() {
    action({ title: 'action()', message: 'Pick one', cancelButtonText: 'Cancel', actions: ['First', 'Second', 'Third'] }).then((result) =>
      this.set('message', `action() → ${result}`),
    )
  }

  onLogin() {
    login({ title: 'login()', message: 'Credentials', okButtonText: 'Sign in', cancelButtonText: 'Cancel', userName: 'user', password: '' }).then(
      (result) => this.set('message', `login() → ${result.result ? result.userName : 'cancelled'}`),
    )
  }

  onShowPopup() {
    const root = getRootLayout()
    const popup = new StackLayout()
    popup.className = 'popup'
    popup.width = 260
    popup.height = 150

    const label = new Label()
    label.text = 'RootLayout popup — tap the shade to close'
    label.textWrap = true
    label.className = 'hint'
    popup.addChild(label)

    root.open(popup, {
      shadeCover: { color: '#000000', opacity: 0.6, tapToClose: true },
      animation: {
        enterFrom: { translateY: 300, opacity: 0, duration: 250 },
        exitTo: { translateY: 300, opacity: 0, duration: 250 },
      },
    })
  }

  onOpenTabs() {
    Frame.topmost().navigate('tabs-page')
  }

  onOpenModal(args: EventData) {
    ;(args.object as View).showModal('tabs-page', { context: { modal: true }, closeCallback: () => this.set('message', 'Modal closed') })
  }

  onAbout() {
    alert({
      title: 'Widgets gallery',
      message: 'Every @nativescript/core UI widget, live on one page.',
      okButtonText: 'Nice',
    })
  }
}
