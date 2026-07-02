export interface ProviderMetadataItem {
  id: string;
  type: 'source' | 'embed';
  name: string;
  rank: number;
  disabled: boolean;
}

const providerMetadata: ProviderMetadataItem[] = [
  {
    id: 'alphaflix-vidking',
    type: 'source',
    name: 'Server 1 (Vidking) 🔥',
    rank: 1,
    disabled: false,
  },
  {
    id: 'openmovie',
    type: 'source',
    name: 'Server 2 (Vixsrc) 🔥',
    rank: 2,
    disabled: false,
  },
  {
    id: 'alphaflix-vidlink',
    type: 'source',
    name: 'Server 3 (VidLink) 🔥',
    rank: 3,
    disabled: false,
  },
  {
    id: 'kkphim',
    type: 'source',
    name: 'Server 4 (KKPhim Vietsub + Lồng tiếng) 🔥',
    rank: 4,
    disabled: false,
  },
  {
    id: 'alphaflix-vidrock',
    type: 'source',
    name: 'Server 5 (Vidrock)',
    rank: 5,
    disabled: false,
  },
  {
    id: 'alphaflix-vidsrcwtf',
    type: 'source',
    name: 'Server 6 (VidSrc.wtf)',
    rank: 6,
    disabled: false,
  },
  {
    id: 'alphaflix-111movies',
    type: 'source',
    name: 'Server 7 (111Movies)',
    rank: 7,
    disabled: false,
  },
  {
    id: 'alphaflix-vidsrc-ru',
    type: 'source',
    name: 'Server 8 (Vidsrc.ru)',
    rank: 8,
    disabled: false,
  },
  {
    id: 'alphaflix-vidsrc',
    type: 'source',
    name: 'Server 9 (Vidsrc)',
    rank: 9,
    disabled: false,
  },
  {
    id: 'openmovie-embed',
    type: 'embed',
    name: 'OpenMovie Stream',
    rank: 80,
    disabled: false,
  },
];

export function getProviderMetadata(): ProviderMetadataItem[] {
  return [...providerMetadata].sort((a, b) => a.rank - b.rank);
}
