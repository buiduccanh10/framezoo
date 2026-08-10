import React from 'react';

import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from '@/components/primitives';

export function SystemStateScreen(props: {
  state: 'bootstrap' | 'offline' | 'maintenance' | 'error' | 'not-found';
  message?: string;
  onRetry?: () => void;
}) {
  if (props.state === 'bootstrap') {
    return <LoadingState label={props.message ?? 'Starting Framezoo...'} />;
  }
  if (props.state === 'offline') {
    return (
      <Screen padded>
        <EmptyState
          title="Offline"
          description={props.message ?? 'Connect to a network and try again.'}
        />
        {props.onRetry ? <Button label="Retry" onPress={props.onRetry} /> : null}
      </Screen>
    );
  }
  if (props.state === 'not-found') {
    return (
      <Screen padded>
        <EmptyState
          title="Not found"
          description={props.message ?? 'This Framezoo screen is not available.'}
        />
      </Screen>
    );
  }
  if (props.state === 'maintenance') {
    return (
      <Screen padded>
        <AppText variant="heading">Maintenance</AppText>
        <AppText variant="muted">
          {props.message ?? 'The backend is temporarily unavailable.'}
        </AppText>
        {props.onRetry ? <Button label="Retry" onPress={props.onRetry} /> : null}
      </Screen>
    );
  }
  return (
    <Screen padded>
      <ErrorState
        message={props.message ?? 'Something went wrong.'}
        onRetry={props.onRetry}
      />
    </Screen>
  );
}
