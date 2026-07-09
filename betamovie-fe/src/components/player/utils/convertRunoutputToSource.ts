import { Stream } from "@/lib/providers";
import {
  SourceFileStream,
  SourceQuality,
  SourceSliceSource,
} from "@/stores/player/utils/qualities";

const allowedQualitiesMap: Record<SourceQuality, SourceQuality> = {
  "4k": "4k",
  "1440": "1440",
  "1080": "1080",
  "480": "480",
  "360": "360",
  "720": "720",
  unknown: "unknown",
};
const allowedQualities = Object.keys(allowedQualitiesMap);
const allowedFileTypes = ["mp4"];

function isAllowedQuality(inp: string): inp is SourceQuality {
  return allowedQualities.includes(inp);
}

export function convertRunoutputToSource(out: {
  stream: Stream;
}): SourceSliceSource {
  if (out.stream.type === "hls") {
    return {
      id: out.stream.id,
      type: "hls",
      url: out.stream.playlist,
      headers: out.stream.headers,
      preferredHeaders: out.stream.preferredHeaders,
      preview: out.stream.preview,
    };
  }
  if (out.stream.type === "dash") {
    return {
      id: out.stream.id,
      type: "dash",
      url: out.stream.manifest,
      headers: out.stream.headers,
      preferredHeaders: out.stream.preferredHeaders,
      preview: out.stream.preview,
    };
  }
  if (out.stream.type === "file") {
    const qualities: Partial<Record<SourceQuality, SourceFileStream>> = {};
    Object.entries(out.stream.qualities).forEach((entry) => {
      if (!isAllowedQuality(entry[0])) {
        console.warn(`unrecognized quality: ${entry[0]}`);
        return;
      }
      if (!allowedFileTypes.includes(entry[1].type)) {
        console.warn(`unrecognized file type: ${entry[1].type}`);
        return;
      }
      qualities[entry[0]] = {
        type: entry[1].type,
        url: entry[1].url,
      };
    });
    return {
      id: out.stream.id,
      type: "file",
      qualities,
      headers: out.stream.headers,
      preferredHeaders: out.stream.preferredHeaders,
      preview: out.stream.preview,
    };
  }
  throw new Error("unrecognized type");
}
