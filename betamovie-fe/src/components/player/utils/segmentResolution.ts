export interface SegmentResolution {
  width: number;
  height: number;
}

class BitReader {
  private readonly data: Uint8Array;
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBit(): number | null {
    if (this.byteOffset >= this.data.length) return null;

    const value = (this.data[this.byteOffset] >> (7 - this.bitOffset)) & 0x01;
    this.bitOffset += 1;

    if (this.bitOffset === 8) {
      this.bitOffset = 0;
      this.byteOffset += 1;
    }

    return value;
  }

  readBits(count: number): number | null {
    if (count < 0 || count > 32) return null;
    let value = 0;

    for (let i = 0; i < count; i += 1) {
      const bit = this.readBit();
      if (bit === null) return null;
      value = (value << 1) | bit;
    }

    return value;
  }

  readUEG(): number | null {
    let leadingZeros = 0;

    while (true) {
      const bit = this.readBit();
      if (bit === null) return null;
      if (bit === 1) break;
      leadingZeros += 1;

      if (leadingZeros > 31) {
        return null;
      }
    }

    if (leadingZeros === 0) {
      return 0;
    }

    const suffix = this.readBits(leadingZeros);
    if (suffix === null) return null;

    return (1 << leadingZeros) - 1 + suffix;
  }

  readSEG(): number | null {
    const value = this.readUEG();
    if (value === null) return null;
    if (value === 0) return 0;
    return value % 2 === 0 ? -(value / 2) : (value + 1) / 2;
  }
}

function removeEmulationPreventionBytes(data: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    if (
      i + 2 < data.length &&
      data[i] === 0x00 &&
      data[i + 1] === 0x00 &&
      data[i + 2] === 0x03
    ) {
      output.push(0x00, 0x00);
      i += 2;
      continue;
    }
    output.push(data[i]);
  }
  return Uint8Array.from(output);
}

function isStartCode(data: Uint8Array, index: number): 3 | 4 | 0 {
  if (index + 3 >= data.length) return 0;
  if (data[index] !== 0x00 || data[index + 1] !== 0x00) return 0;

  if (data[index + 2] === 0x01) return 3;
  if (
    index + 4 < data.length &&
    data[index + 2] === 0x00 &&
    data[index + 3] === 0x01
  )
    return 4;

  return 0;
}

function findH264SpsNalUnit(data: Uint8Array): Uint8Array | null {
  for (let i = 0; i < data.length - 5; i += 1) {
    const startCodeLength = isStartCode(data, i);
    if (!startCodeLength) continue;

    const nalStart = i + startCodeLength;
    if (nalStart >= data.length) continue;

    const nalType = data[nalStart] & 0x1f;
    if (nalType !== 7) continue;

    let nalEnd = data.length;
    for (let j = nalStart + 1; j < data.length - 4; j += 1) {
      if (isStartCode(data, j)) {
        nalEnd = j;
        break;
      }
    }

    return data.subarray(nalStart, nalEnd);
  }

  return null;
}

function skipScalingList(reader: BitReader, size: number): boolean {
  let lastScale = 8;
  let nextScale = 8;

  for (let i = 0; i < size; i += 1) {
    if (nextScale !== 0) {
      const deltaScale = reader.readSEG();
      if (deltaScale === null) return false;
      nextScale = (lastScale + deltaScale + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }

  return true;
}

function parseH264SpsResolution(
  spsNalUnit: Uint8Array,
): SegmentResolution | null {
  if (!spsNalUnit.length) return null;
  if ((spsNalUnit[0] & 0x1f) !== 7) return null;

  const rbsp = removeEmulationPreventionBytes(spsNalUnit.subarray(1));
  const reader = new BitReader(rbsp);

  const profileIdc = reader.readBits(8);
  if (profileIdc === null) return null;

  if (reader.readBits(8) === null) return null; // constraint_set flags + reserved
  if (reader.readBits(8) === null) return null; // level_idc
  if (reader.readUEG() === null) return null; // seq_parameter_set_id

  const extendedProfiles = new Set([
    100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
  ]);

  let chromaFormatIdc = 1;
  if (extendedProfiles.has(profileIdc)) {
    const parsedChromaFormat = reader.readUEG();
    if (parsedChromaFormat === null) return null;
    chromaFormatIdc = parsedChromaFormat;

    if (chromaFormatIdc === 3 && reader.readBit() === null) return null;
    if (reader.readUEG() === null) return null; // bit_depth_luma_minus8
    if (reader.readUEG() === null) return null; // bit_depth_chroma_minus8
    if (reader.readBit() === null) return null; // qpprime_y_zero_transform_bypass_flag

    const scalingMatrixPresent = reader.readBit();
    if (scalingMatrixPresent === null) return null;
    if (scalingMatrixPresent === 1) {
      const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < scalingListCount; i += 1) {
        const scalingListPresent = reader.readBit();
        if (scalingListPresent === null) return null;
        if (scalingListPresent === 1) {
          const ok = skipScalingList(reader, i < 6 ? 16 : 64);
          if (!ok) return null;
        }
      }
    }
  }

  if (reader.readUEG() === null) return null; // log2_max_frame_num_minus4

  const picOrderCntType = reader.readUEG();
  if (picOrderCntType === null) return null;
  if (picOrderCntType === 0) {
    if (reader.readUEG() === null) return null; // log2_max_pic_order_cnt_lsb_minus4
  } else if (picOrderCntType === 1) {
    if (reader.readBit() === null) return null; // delta_pic_order_always_zero_flag
    if (reader.readSEG() === null) return null; // offset_for_non_ref_pic
    if (reader.readSEG() === null) return null; // offset_for_top_to_bottom_field

    const cycleCount = reader.readUEG();
    if (cycleCount === null) return null;
    for (let i = 0; i < cycleCount; i += 1) {
      if (reader.readSEG() === null) return null; // offset_for_ref_frame[i]
    }
  }

  if (reader.readUEG() === null) return null; // max_num_ref_frames
  if (reader.readBit() === null) return null; // gaps_in_frame_num_value_allowed_flag

  const picWidthInMbsMinus1 = reader.readUEG();
  const picHeightInMapUnitsMinus1 = reader.readUEG();
  if (picWidthInMbsMinus1 === null || picHeightInMapUnitsMinus1 === null)
    return null;

  const frameMbsOnlyFlag = reader.readBit();
  if (frameMbsOnlyFlag === null) return null;
  if (frameMbsOnlyFlag === 0 && reader.readBit() === null) return null; // mb_adaptive_frame_field_flag
  if (reader.readBit() === null) return null; // direct_8x8_inference_flag

  const frameCroppingFlag = reader.readBit();
  if (frameCroppingFlag === null) return null;

  let frameCropLeftOffset = 0;
  let frameCropRightOffset = 0;
  let frameCropTopOffset = 0;
  let frameCropBottomOffset = 0;
  if (frameCroppingFlag === 1) {
    const left = reader.readUEG();
    const right = reader.readUEG();
    const top = reader.readUEG();
    const bottom = reader.readUEG();
    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }
    frameCropLeftOffset = left;
    frameCropRightOffset = right;
    frameCropTopOffset = top;
    frameCropBottomOffset = bottom;
  }

  let cropUnitX = 1;
  let cropUnitY = 2 - frameMbsOnlyFlag;
  if (chromaFormatIdc === 1) {
    cropUnitX = 2;
    cropUnitY = 2 * (2 - frameMbsOnlyFlag);
  } else if (chromaFormatIdc === 2) {
    cropUnitX = 2;
    cropUnitY = 2 - frameMbsOnlyFlag;
  } else if (chromaFormatIdc === 3) {
    cropUnitX = 1;
    cropUnitY = 2 - frameMbsOnlyFlag;
  }

  const width =
    (picWidthInMbsMinus1 + 1) * 16 -
    (frameCropLeftOffset + frameCropRightOffset) * cropUnitX;
  const height =
    (picHeightInMapUnitsMinus1 + 1) * 16 * (2 - frameMbsOnlyFlag) -
    (frameCropTopOffset + frameCropBottomOffset) * cropUnitY;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { width, height };
}

export function extractSegmentResolution(
  payload: ArrayBuffer,
): SegmentResolution | null {
  const bytes = new Uint8Array(payload);
  if (bytes.length < 8) return null;

  const spsNalUnit = findH264SpsNalUnit(bytes);
  if (!spsNalUnit) return null;

  return parseH264SpsResolution(spsNalUnit);
}
