import type { ImageSourcePropType } from 'react-native';

export type PlatformAssetName =
  | 'appletv'
  | 'disney'
  | 'hulu'
  | 'max'
  | 'netflix'
  | 'paramount'
  | 'prime';

export const platformAssets: Record<
  PlatformAssetName,
  ImageSourcePropType
> = {
  appletv: require('./platforms/appletv.png'),
  disney: require('./platforms/disney.png'),
  hulu: require('./platforms/hulu.png'),
  max: require('./platforms/max.png'),
  netflix: require('./platforms/netflix.png'),
  paramount: require('./platforms/paramount.png'),
  prime: require('./platforms/prime.png'),
};

export type TomatoAssetName =
  | 'certified_fresh'
  | 'fresh'
  | 'rotten'
  | 'popcorn_empty'
  | 'popcorn_fresh'
  | 'popcorn_rotten';

export const tomatoAssets: Record<TomatoAssetName, ImageSourcePropType> = {
  certified_fresh: require('./tomatoes/Certified_Fresh.png'),
  fresh: require('./tomatoes/Fresh.png'),
  rotten: require('./tomatoes/Rotten.png'),
  popcorn_empty: require('./tomatoes/Popcorn_Empty.png'),
  popcorn_fresh: require('./tomatoes/Popcorn_Fresh.png'),
  popcorn_rotten: require('./tomatoes/Popcorn_Rotten.png'),
};

export const ratingAssets = {
  imdb: require('./ratings/imdb.png') as ImageSourcePropType,
  tmdb: require('./ratings/tmdb.png') as ImageSourcePropType,
};

export function getPlatformAsset(
  provider?: string,
): ImageSourcePropType | undefined {
  if (!provider) return undefined;

  const key = provider.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, PlatformAssetName> = {
    appletv: 'appletv',
    appletvplus: 'appletv',
    disney: 'disney',
    disneyplus: 'disney',
    hbo: 'max',
    max: 'max',
    hulu: 'hulu',
    netflix: 'netflix',
    paramount: 'paramount',
    paramountplus: 'paramount',
    prime: 'prime',
    primevideo: 'prime',
  };

  const assetName = aliases[key];
  return assetName ? platformAssets[assetName] : undefined;
}

export function getTomatoAsset(
  icon: 'certified_fresh' | 'fresh' | 'rotten',
): ImageSourcePropType {
  return tomatoAssets[icon];
}

export function getPopcornAsset(
  icon: 'upright' | 'spilled' | 'empty',
): ImageSourcePropType {
  if (icon === 'upright') return tomatoAssets.popcorn_fresh;
  if (icon === 'spilled') return tomatoAssets.popcorn_rotten;
  return tomatoAssets.popcorn_empty;
}
