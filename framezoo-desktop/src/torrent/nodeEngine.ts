import { SidecarTorrentEngine } from "./sidecarEngine";

/** JSON-lines adapter for the portable Node torrent worker. */
export class NodeTorrentEngine extends SidecarTorrentEngine {
  constructor(workerPath: string) {
    super(process.execPath, [workerPath], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    });
  }
}
