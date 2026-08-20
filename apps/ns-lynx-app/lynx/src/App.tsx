import { useCallback, useState } from '@lynx-js/react';
import {
  useInitData,
  useLynxGlobalEventListener,
} from '@lynx-js/react';

import './App.css';

interface HostInitData {
  /** Sent by the NativeScript host through `<LynxView initData="…">`. */
  greeting?: string;
  renderedAt?: string;
}

/**
 * Everything on this screen is rendered by the Lynx engine inside a
 * `<LynxView>` that a NativeScript page owns. It reads the data the host
 * passed in, and reacts to global events the host sends at runtime.
 */
export function App() {
  const initData = useInitData() as HostInitData;
  const [taps, setTaps] = useState(0);
  const [hostMessage, setHostMessage] = useState('waiting for the host…');

  // `lynxView.sendGlobalEvent('hostPing', [text])` on the NativeScript side
  // lands here.
  useLynxGlobalEventListener('hostPing', (text: string) => {
    setHostMessage(text);
  });

  const onTap = useCallback(() => {
    setTaps((count) => count + 1);
  }, []);

  return (
    <view class="page">
      <view class="card">
        <text class="title">React on Lynx</text>
        <text class="subtitle">rendered inside a NativeScript page</text>
      </view>

      <view class="card">
        <text class="label">initData.greeting</text>
        <text class="value">{initData?.greeting ?? '(none passed)'}</text>
        <text class="label">initData.renderedAt</text>
        <text class="value">{initData?.renderedAt ?? '(none passed)'}</text>
      </view>

      <view class="card">
        <text class="label">last global event from the host</text>
        <text class="value">{hostMessage}</text>
      </view>

      <view class="card button" bindtap={onTap}>
        <text class="button-text">Tapped {taps} times inside Lynx</text>
      </view>
    </view>
  );
}
