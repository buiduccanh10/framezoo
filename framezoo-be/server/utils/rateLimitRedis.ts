import Redis from 'ioredis';

const getRedisUrl = (): string =>
  process.env.REDIS_URL?.trim() ||
  `redis://${process.env.REDIS_HOST?.trim() || 'localhost'}:${process.env.REDIS_PORT?.trim() || '6379'}`;

export type FailFastRedis = {
  getConnectedClient: () => Promise<Redis>;
  reset: (expectedClient?: Redis) => void;
};

const isClientReady = (client: Redis): boolean =>
  client.status === 'ready' && Boolean(client.stream?.writable) && !client.stream?.destroyed;

// Keep enableOfflineQueue: false so Redis outages fail fast, but await connect()
// explicitly because ioredis rejects commands issued while lazyConnect is still 'wait'.
export const createFailFastRedis = (): FailFastRedis => {
  let client: Redis | null = null;
  let connectPromise: Promise<void> | null = null;

  const reset = (expectedClient?: Redis): void => {
    if (expectedClient && client !== expectedClient) return;
    const stale = client;
    client = null;
    connectPromise = null;
    stale?.disconnect();
  };

  const getConnectedClient = async (): Promise<Redis> => {
    if (client && !isClientReady(client) && client.status !== 'wait' && connectPromise === null) {
      reset(client);
    }

    if (!client) {
      const nextClient = new Redis(getRedisUrl(), {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      nextClient.on('error', () => {});
      client = nextClient;
    }

    const activeClient = client;
    if (isClientReady(activeClient)) {
      return activeClient;
    }

    if (connectPromise === null) {
      connectPromise = activeClient.connect().finally(() => {
        if (client === activeClient) {
          connectPromise = null;
        }
      });
    }

    try {
      await connectPromise;
    } catch (error) {
      reset(activeClient);
      throw error;
    }

    if (!isClientReady(activeClient)) {
      reset(activeClient);
      throw new Error(`Redis client not ready (status: ${activeClient.status})`);
    }

    return activeClient;
  };

  return { getConnectedClient, reset };
};
