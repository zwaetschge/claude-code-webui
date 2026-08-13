import { api } from '@/services/api';

/**
 * Browser push registration.
 *
 * Push is opt-in and entirely optional: without VAPID keys on the server, or
 * without permission from the user, the app falls back to socket-delivered
 * notifications while a tab is open.
 */

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  // Returned as a plain ArrayBuffer: PushManager types reject the generic
  // Uint8Array<ArrayBufferLike> that Uint8Array.from produces.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getWebPushState(): Promise<'unsupported' | 'unconfigured' | 'on' | 'off'> {
  if (!isWebPushSupported()) return 'unsupported';
  const publicKey = await fetchPublicKey();
  if (!publicKey) return 'unconfigured';
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? 'on' : 'off';
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const response = await api.get<{ success: boolean; data: { publicKey: string | null } }>(
      '/api/workspace/push/public-key'
    );
    return response.data.data?.publicKey ?? null;
  } catch {
    return null;
  }
}

/** Ask for permission, subscribe, and hand the subscription to the server. */
export async function enableWebPush(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const publicKey = await fetchPublicKey();
  if (!publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;

  await api.post('/api/workspace/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return true;
}

export async function disableWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api.post('/api/workspace/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
