import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { PlatformIcon } from '@/components/navigation';
import { ExternalRatings } from '@/components/media';
import {
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/primitives';
import { demoMedia } from '@/services/metadata';
import {
  getExternalRatings,
  getFeaturedMedia,
} from '@/services/api/metadata';
import { useAuthStore } from '@/state/auth/store';
import { useLibraryStore } from '@/state/library/store';
import { useDeviceMode } from '@/platform/DeviceModeContext';
import { colors, radius, spacing } from '@/theme';
import type { MediaItem } from '@/types';

interface FeaturedCarouselProps {
  onShowDetails: (media: MediaItem) => void;
  onPlay: (media: MediaItem) => void;
}

function getHeroHeight(width: number, height: number, isTV: boolean) {
  return isTV
    ? Math.max(560, Math.round(width * 0.56))
    : Math.round(height * 0.5);
}

function FeaturedSkeleton(props: { height: number }) {
  return (
    <View style={[styles.skeleton, { height: props.height }]}>
      <View style={styles.skeletonImage} />
      <View style={styles.skeletonCopy}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, styles.skeletonShort]} />
        <View style={styles.skeletonButtons}>
          <View style={styles.skeletonButton} />
          <View style={styles.skeletonButton} />
        </View>
      </View>
    </View>
  );
}

function ActionButton(props: {
  label: string;
  icon: 'play' | 'info';
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[styles.action, props.secondary && styles.actionSecondary]}
    >
      <PlatformIcon
        color={props.secondary ? colors.text : colors.black}
        focused
        name={props.icon}
        size={18}
      />
      <AppText
        style={props.secondary ? styles.actionSecondaryText : styles.actionText}
      >
        {props.label}
      </AppText>
    </Pressable>
  );
}

export function FeaturedCarousel(props: FeaturedCarouselProps) {
  const backendUrl = useAuthStore(state => state.backendUrl);
  const progress = useLibraryStore(state => state.progress);
  const { isTV } = useDeviceMode();
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const mediaQuery = useQuery({
    queryKey: ['discover-featured', backendUrl],
    queryFn: () =>
      backendUrl
        ? getFeaturedMedia(backendUrl)
        : Promise.resolve(demoMedia),
    staleTime: 5 * 60 * 1000,
  });
  const media = mediaQuery.data ?? [];
  const currentMedia = media[currentIndex] ?? media[0];
  const ratingsQuery = useQuery({
    queryKey: [
      'featured-ratings',
      backendUrl,
      currentMedia?.type,
      currentMedia?.id,
      currentMedia?.imdbId,
      currentMedia?.title,
      currentMedia?.year,
    ],
    enabled: Boolean(backendUrl && currentMedia),
    queryFn: () =>
      getExternalRatings(backendUrl as string, currentMedia as MediaItem),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const progressItem = progress.find(
    item => item.mediaId === currentMedia?.id && item.type === currentMedia.type,
  );
  const progressPercentage =
    progressItem && progressItem.duration > 0
      ? Math.min(100, (progressItem.position / progressItem.duration) * 100)
      : undefined;

  useEffect(() => {
    if (currentIndex >= media.length && media.length > 0) {
      setCurrentIndex(0);
    }
  }, [currentIndex, media.length]);

  const transitionTo = (index: number) => {
    if (index === currentIndex || !media.length) return;

    contentOpacity.stopAnimation();
    Animated.timing(contentOpacity, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setCurrentIndex(index);
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  };

  useEffect(() => {
    if (isPaused || media.length < 2) return;
    const timer = setInterval(() => {
      transitionTo((currentIndex + 1) % media.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [currentIndex, isPaused, media.length]);

  const goToNext = () => {
    transitionTo((currentIndex + 1) % media.length);
  };

  const goToPrevious = () => {
    transitionTo((currentIndex - 1 + media.length) % media.length);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => setIsPaused(true),
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > 50) {
            if (gesture.dx < 0) goToNext();
            else goToPrevious();
          }
          setIsPaused(false);
        },
        onPanResponderTerminate: () => setIsPaused(false),
      }),
    [currentIndex, media.length],
  );

  if (mediaQuery.isLoading) {
    return <FeaturedSkeleton height={getHeroHeight(width, height, isTV)} />;
  }
  if (mediaQuery.isError) {
    return (
      <ErrorState
        message={
          mediaQuery.error instanceof Error
            ? mediaQuery.error.message
            : 'Featured media request failed.'
        }
        onRetry={() => mediaQuery.refetch().catch(() => undefined)}
      />
    );
  }
  if (!currentMedia) {
    return (
      <EmptyState
        title="No featured media"
        description="Try refreshing the Discover page."
      />
    );
  }

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.hero, { height: getHeroHeight(width, height, isTV) }]}
    >
      {currentMedia.backdrop ? (
        <Animated.Image
          accessibilityLabel={currentMedia.title}
          resizeMode="cover"
          source={{ uri: currentMedia.backdrop }}
          style={[styles.backdrop, { opacity: contentOpacity }]}
        />
      ) : null}
      <View pointerEvents="none" style={styles.imageTint} />
      <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
        {currentMedia.logo ? (
          <Animated.Image
            accessibilityLabel={`${currentMedia.title} logo`}
            resizeMode="contain"
            source={{ uri: currentMedia.logo }}
            style={[styles.logo, { width: Math.min(250, width * 0.66) }]}
          />
        ) : (
          <AppText numberOfLines={2} style={styles.title}>
            {currentMedia.title}
          </AppText>
        )}
        <View style={styles.metadata}>
          <ExternalRatings
            loading={ratingsQuery.isLoading}
            ratings={ratingsQuery.data}
            tmdbRating={currentMedia.rating}
            tmdbVotes={currentMedia.voteCount}
          />
          {currentMedia.year ? (
            <AppText variant="caption" style={styles.metadataText}>
              • {currentMedia.year}
            </AppText>
          ) : null}
          {currentMedia.numberOfSeasons ? (
            <AppText variant="caption" style={styles.metadataText}>
              • {currentMedia.numberOfSeasons} seasons
            </AppText>
          ) : null}
        </View>
        {currentMedia.overview ? (
          <AppText numberOfLines={isTV ? 4 : 2} style={styles.overview}>
            {currentMedia.overview}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <ActionButton
            icon="play"
            label={progressItem ? 'Resume' : 'Play'}
            onPress={() => props.onPlay(currentMedia)}
          />
          <ActionButton
            icon="info"
            label="More info"
            onPress={() => props.onShowDetails(currentMedia)}
            secondary
          />
        </View>
        {progressPercentage !== undefined ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressLabel}>
              <AppText variant="caption" style={styles.metadataText}>
                {progressItem?.season && progressItem.episode
                  ? `S${progressItem.season} E${progressItem.episode}`
                  : 'Resume watching'}
              </AppText>
              <AppText variant="caption" style={styles.metadataText}>
                {Math.round(progressPercentage)}%
              </AppText>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progressPercentage}%` }]}
              />
            </View>
          </View>
        ) : null}
      </Animated.View>
      <View style={styles.navigation}>
        <View style={styles.dots}>
          {media.map((item, index) => (
            <Pressable
              accessibilityLabel={`Go to featured slide ${index + 1}`}
              accessibilityRole="button"
              key={`${item.type}:${item.id}`}
              onPress={() => transitionTo(index)}
              style={[styles.dot, index === currentIndex && styles.dotActive]}
            />
          ))}
        </View>
      </View>
      <Pressable
        accessibilityLabel="Previous featured media"
        accessibilityRole="button"
        onPress={goToPrevious}
        style={[styles.navButton, styles.previousButton]}
      >
        <PlatformIcon color={colors.text} focused name="chevronLeft" size={22} />
      </Pressable>
      <Pressable
        accessibilityLabel="Next featured media"
        accessibilityRole="button"
        onPress={goToNext}
        style={[styles.navButton, styles.nextButton]}
      >
        <PlatformIcon color={colors.text} focused name="chevronRight" size={22} />
      </Pressable>
      {mediaQuery.isFetching ? (
        <View style={styles.refreshing}>
          <LoadingState label="Updating featured media..." />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  imageTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
  },
  content: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.lg,
  },
  logo: {
    width: 250,
    height: 82,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    marginBottom: spacing.md,
    textShadowColor: colors.black,
    textShadowRadius: 8,
  },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metadataText: { color: 'rgba(255, 255, 255, 0.82)', fontWeight: '700' },
  separator: { color: 'rgba(255, 255, 255, 0.5)' },
  overview: {
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.text,
  },
  actionSecondary: {
    backgroundColor: 'rgba(21, 21, 21, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  actionText: { color: colors.black, fontWeight: '800' },
  actionSecondaryText: { color: colors.text, fontWeight: '800' },
  progressBlock: { marginTop: spacing.md, maxWidth: 380 },
  progressLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  progressTrack: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 99,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  navigation: {
    position: 'absolute',
    zIndex: 3,
    right: 0,
    bottom: spacing.lg,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  navButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
  },
  previousButton: {
    position: 'absolute',
    zIndex: 4,
    left: spacing.lg,
    top: '50%',
    transform: [{ translateY: -19 }],
  },
  nextButton: {
    position: 'absolute',
    zIndex: 4,
    right: spacing.lg,
    top: '50%',
    transform: [{ translateY: -19 }],
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  dotActive: { width: 19, backgroundColor: colors.text },
  refreshing: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 4,
    transform: [{ scale: 0.7 }],
  },
  skeleton: {
    width: '100%',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  skeletonImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonCopy: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.lg,
  },
  skeletonLine: {
    height: 14,
    width: '82%',
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  skeletonTitle: { height: 36, width: '58%' },
  skeletonShort: { width: '48%' },
  skeletonButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  skeletonButton: {
    width: 110,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.border,
  },
});
