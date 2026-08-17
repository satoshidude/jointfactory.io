// NIP-07 window.nostr interface
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: NostrUnsignedEvent): Promise<NostrSignedEvent>;
    };
  }
}

interface NostrUnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

interface NostrSignedEvent extends NostrUnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export function hasExtension(): boolean {
  return !!window.nostr;
}

export async function loginWithExtension(): Promise<NostrSignedEvent> {
  if (!window.nostr) throw new Error('No Nostr extension found');
  const pubkey = await window.nostr.getPublicKey();
  const event = await window.nostr.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', window.location.origin + '/api/auth/nostr'], ['method', 'POST']],
    content: '',
  });
  if (!event.pubkey) event.pubkey = pubkey;
  return event;
}

export function loginWithNsec(_nsecOrHex: string): NostrSignedEvent {
  // We need nostr-tools for this — dynamic import in the component
  // This is a placeholder; actual signing happens in the modal
  throw new Error('Use signWithNsec instead');
}

export async function generateKeypair(): Promise<{ nsec: string; npub: string; secretKey: Uint8Array }> {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { nsecEncode, npubEncode } = await import('nostr-tools/nip19');
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return {
    nsec: nsecEncode(sk),
    npub: npubEncode(pk),
    secretKey: sk,
  };
}

export async function signWithNsec(nsecOrHex: string): Promise<NostrSignedEvent> {
  const { finalizeEvent } = await import('nostr-tools/pure');
  const { decode } = await import('nostr-tools/nip19');

  let secretKey: Uint8Array;
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = decode(nsecOrHex);
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
    secretKey = decoded.data;
  } else {
    secretKey = hexToBytes(nsecOrHex);
  }

  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', window.location.origin + '/api/auth/nostr'], ['method', 'POST']],
    content: '',
  }, secretKey);

  return event as NostrSignedEvent;
}

export async function signWithSecretKey(sk: Uint8Array): Promise<NostrSignedEvent> {
  const { finalizeEvent } = await import('nostr-tools/pure');
  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', window.location.origin + '/api/auth/nostr'], ['method', 'POST']],
    content: '',
  }, sk);
  return event as NostrSignedEvent;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
