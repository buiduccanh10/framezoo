import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';

type ImageTone = 'light' | 'dark';

type GlobalWithBuffer = typeof globalThis & {
  Buffer?: typeof Buffer;
};

function getSampleUrl(uri: string) {
  return uri
    .replace('/original/', '/w300/')
    .replace(/\/w\d+\//, '/w300/');
}

export async function getImageTone(uri: string): Promise<ImageTone> {
  const globalWithBuffer = globalThis as GlobalWithBuffer;
  if (!globalWithBuffer.Buffer) {
    globalWithBuffer.Buffer = Buffer;
  }

  const response = await fetch(getSampleUrl(uri));
  if (!response.ok) {
    throw new Error(`Image sample request failed: ${response.status}`);
  }

  const image = jpeg.decode(new Uint8Array(await response.arrayBuffer()), {
    useTArray: true,
  });
  const sampleStep = 4 * 24;
  let luminance = 0;
  let sampleCount = 0;

  for (let index = 0; index < image.data.length; index += sampleStep) {
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    luminance += (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    sampleCount += 1;
  }

  return sampleCount && luminance / sampleCount > 0.52 ? 'light' : 'dark';
}
