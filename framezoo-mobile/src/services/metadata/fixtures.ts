import type { MediaItem } from '@/types';

export const demoMedia: MediaItem[] = [
  {
    id: 'demo-1',
    title: 'Framezoo Premiere',
    type: 'movie',
    year: 2025,
    poster: 'https://image.tmdb.org/t/p/w342/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    overview: 'A local UI fixture used when no backend is configured.',
    rating: 8.1,
  },
  {
    id: 'demo-2',
    title: 'Night Signals',
    type: 'show',
    year: 2024,
    poster: 'https://image.tmdb.org/t/p/w342/6Wm7P6y22UZA40QuKPaB8p7m7aX.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/6Wm7P6y22UZA40QuKPaB8p7m7aX.jpg',
    overview: 'A series fixture used to validate episode navigation.',
    rating: 7.8,
  },
  {
    id: 'demo-3',
    title: 'Signal to Noise',
    type: 'movie',
    year: 2023,
    poster: 'https://image.tmdb.org/t/p/w342/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg',
    overview: 'A second movie fixture for cards and lists.',
    rating: 7.4,
  },
  {
    id: 'demo-4',
    title: 'Afterimage',
    type: 'show',
    year: 2022,
    poster: 'https://image.tmdb.org/t/p/w342/1X4hM6s4t5o7Xn0n8Q2Q1bG5xBv.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/1X4hM6s4t5o7Xn0n8Q2Q1bG5xBv.jpg',
    overview: 'A series fixture for TV rails.',
    rating: 7.2,
  },
];
