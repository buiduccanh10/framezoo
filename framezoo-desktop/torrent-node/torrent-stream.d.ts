declare module "torrent-stream" {
  export interface TorrentFile {
    name?: string;
    path?: string;
    length: number;
    offset: number;
  }

  export interface TorrentMetadata {
    infoHash: string;
    length: number;
    pieceLength: number;
    pieces: Array<string | Buffer>;
    files: TorrentFile[];
  }

  export interface TorrentWire {
    peerAddress?: string;
    peerChoking?: boolean;
    amInterested?: boolean;
    _finished?: boolean;
    peerPieces?: { get(index: number): boolean } | boolean[];
    requests?: Array<{ piece: number; offset: number; length: number }>;
    request(
      piece: number,
      offset: number,
      length: number,
      callback: (error: Error | null, block?: Buffer) => void,
    ): void;
    cancel?(piece: number, offset: number, length: number): void;
    interested?(): void;
    downloadSpeed?(): number;
    destroy?(): void;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export interface TorrentEngine {
    infoHash: string;
    torrent: TorrentMetadata | null;
    files: TorrentFile[];
    swarm: {
      wires: TorrentWire[];
      queued: number;
      paused: boolean;
      size?: number;
      connectTimeout?: number;
      handshakeTimeout?: number;
      downloadSpeed(): number;
      add(address: string): void;
      on(event: string, listener: (...args: any[]) => void): this;
    };
    on(event: string, listener: (...args: any[]) => void): this;
    listen(port?: number, callback?: (error?: Error) => void): void;
    connect(address: string): void;
    destroy(callback?: (error?: Error) => void): void;
  }

  export interface TorrentOptions {
    path?: string;
    tmp?: string;
    name?: string;
    id?: string;
    trackers?: string[];
    connections?: number;
    timeout?: number;
    dht?: boolean;
    tracker?: boolean;
    uploads?: number;
    verify?: boolean;
    port?: number;
  }

  function torrentStream(
    link: string,
    options?: TorrentOptions,
  ): TorrentEngine;

  export = torrentStream;
}
