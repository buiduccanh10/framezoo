const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

const [addonPath, videoPath] = process.argv.slice(2);
assert(addonPath && videoPath, "Pass the native addon and a video longer than 6 seconds");
const addon = require(addonPath);
let window;
let player;
let position = null;
const timeout = setTimeout(() => {
  console.error("Timed out waiting for the first frame");
  process.exit(1);
}, 15_000);

app.whenReady().then(() => {
  window = new BrowserWindow({ show: true, width: 400, height: 300 });
  player = addon.createPlayer(
    window.getNativeWindowHandle(),
    { x: 0, y: 0, width: 400, height: 300 },
    (event) => {
      if (event.type === "property" && event.name === "time-pos") {
        position = event.data;
      }
      if (event.type === "video-frame") {
        clearTimeout(timeout);
        try {
          assert(position >= 5, `First frame is at ${position}, expected 6 seconds`);
          console.log(`First frame position: ${position}`);
          addon.destroyPlayer(player);
          window.destroy();
          app.quit();
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      }
    },
  );
  assert.throws(() => addon.loadPlayer(player, {
    url: videoPath,
    startAt: Infinity,
    isTorrent: true,
  }), /startAt must be finite/);
  addon.loadPlayer(player, {
    url: videoPath,
    type: "file",
    startAt: 6,
    autoplay: true,
    generation: 1,
    isTorrent: true,
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
