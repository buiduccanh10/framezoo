declare module "bittorrent-tracker/client" {
  type Listener = (...args: any[]) => void;
  interface Client {
    on(event: string, listener: Listener): this;
    start(options?: { numwant?: number }): void;
    stop(options?: Record<string, unknown>): void;
    destroy(callback?: (error?: Error) => void): void;
  }
  const Client: new (
    peerId: Buffer,
    port: number,
    torrent: { infoHash: string; announce: string[] },
  ) => Client;
  export = Client;
}

declare module "bittorrent-dht/client" {
  type Listener = (...args: any[]) => void;
  interface Client {
    on(event: string, listener: Listener): this;
    lookup(infoHash: string, callback?: (error?: Error) => void): () => void;
    destroy(callback?: (error?: Error) => void): void;
  }
  const Client: new (options?: { concurrency?: number }) => Client;
  export = Client;
}
