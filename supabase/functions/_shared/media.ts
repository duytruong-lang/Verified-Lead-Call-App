import { parseBuffer } from 'npm:music-metadata@11.14.0';

export type DetectedAudio = { mime: string; kind: string } | null;

export function detectAudio(b: Uint8Array): DetectedAudio {
  const ascii = (a: number, z: number) => String.fromCharCode(...b.slice(a, z));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', kind: 'wav' };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', kind: 'webm' };
  if (b.length >= 4 && ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', kind: 'ogg' };
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', kind: 'mp4' };
  if (b.length >= 3 && ascii(0, 3) === 'ID3') return { mime: 'audio/mpeg', kind: 'mp3' };
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { mime: 'audio/aac', kind: 'aac' };
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { mime: 'audio/mpeg', kind: 'mp3' };
  return null;
}

export async function validateAudio(bytes: Uint8Array, declaredType: string): Promise<{ contentType: string; durationSeconds: number; playable: boolean }> {
  const detected = detectAudio(bytes);
  if (!detected || (detected.mime !== declaredType && !(declaredType === 'audio/x-wav' && detected.mime === 'audio/wav'))) {
    throw new Error('recording_mime_mismatch');
  }
  if (detected.kind === 'wav') validateWaveChunks(bytes);
  const metadata = await parseBuffer(bytes, { mimeType: declaredType }, { duration: true, skipCovers: true });
  if (!metadata.format.hasAudio || !metadata.format.codec) throw new Error('recording_audio_track_missing');
  let duration = metadata.format.duration ?? 0;
  if (!(duration > 0) && detected.kind === 'webm') duration = webmDuration(bytes, metadata.format.codec);
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('recording_duration_unavailable');
  return { contentType: detected.mime, durationSeconds: Math.ceil(duration), playable: true };
}

function validateWaveChunks(bytes: Uint8Array): void {
  if (bytes.length < 44) throw new Error('recording_wave_truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('recording_wave_size_mismatch');
  let offset = 12;
  let hasFormat = false;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + chunkSize;
    if (bodyEnd > bytes.length) throw new Error('recording_wave_chunk_truncated');
    if (id === 'fmt ') {
      if (chunkSize < 16) throw new Error('recording_wave_format_invalid');
      const format = view.getUint16(bodyStart, true);
      const channels = view.getUint16(bodyStart + 2, true);
      const sampleRate = view.getUint32(bodyStart + 4, true);
      const blockAlign = view.getUint16(bodyStart + 12, true);
      if (![1, 3].includes(format) || channels < 1 || channels > 8 || sampleRate < 8000 || !blockAlign) throw new Error('recording_wave_format_invalid');
      hasFormat = true;
    }
    if (id === 'data') dataSize = chunkSize;
    offset = bodyEnd + (chunkSize % 2);
  }
  if (!hasFormat || !dataSize || offset !== bytes.length) throw new Error('recording_wave_incomplete');
}

function webmDuration(bytes: Uint8Array, codec: string): number {
  const readVint = (offset: number, keepMarker = false): { width: number; value: number; unknown: boolean } | null => {
    if (offset >= bytes.length) return null;
    let mask = 0x80; let width = 1;
    while (width <= 8 && (bytes[offset] & mask) === 0) { mask >>= 1; width++; }
    if (width > 8 || offset + width > bytes.length) return null;
    let value = keepMarker ? bytes[offset] : bytes[offset] & (mask - 1);
    for (let i = 1; i < width; i++) value = value * 256 + bytes[offset + i];
    const unknown = !keepMarker && value === 2 ** (7 * width) - 1;
    return { width, value, unknown };
  };
  const readElement = (offset: number) => {
    const id = readVint(offset, true);
    if (!id) return null;
    const size = readVint(offset + id.width);
    if (!size) return null;
    const dataStart = offset + id.width + size.width;
    const dataEnd = size.unknown ? bytes.length : dataStart + size.value;
    if (dataEnd > bytes.length || dataEnd < dataStart) return null;
    return { id: id.value, dataStart, dataEnd, next: dataEnd };
  };
  const readUint = (start: number, end: number) => {
    if (end - start > 8) return 0;
    let value = 0; for (let i = start; i < end; i++) value = value * 256 + bytes[i];
    return value;
  };
  const readFloat = (start: number, end: number) => {
    const length = end - start;
    if (length !== 4 && length !== 8) return 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
    return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
  };
  const master = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe1, 0x1f43b675, 0xa0]);
  const segments: Array<{ start: number; end: number }> = [];
  let timecodeScale = 1_000_000;
  let declaredDuration = 0;
  const tracks = new Map<number, { number: number; audio: boolean; codec: string; defaultDuration: number }>();
  const clusters: Array<{ start: number; end: number }> = [];
  const scan = (start: number, end: number) => {
    let cursor = start;
    while (cursor + 2 <= end) {
      const el = readElement(cursor);
      if (!el || el.dataEnd > end || el.next <= cursor) break;
      if (el.id === 0x18538067) segments.push({ start: el.dataStart, end: el.dataEnd });
      if (el.id === 0x2ad7b1) timecodeScale = readUint(el.dataStart, el.dataEnd) || timecodeScale;
      if (el.id === 0x4489) declaredDuration = readFloat(el.dataStart, el.dataEnd);
      if (el.id === 0x1f43b675) clusters.push({ start: el.dataStart, end: el.dataEnd });
      if (el.id === 0xae) {
        const fields = parseTrack(el.dataStart, el.dataEnd);
        if (fields.number > 0) tracks.set(fields.number, fields);
      }
      if (master.has(el.id) && el.id !== 0xa0) scan(el.dataStart, el.dataEnd);
      cursor = el.next;
    }
  };
  const parseTrack = (start: number, end: number) => {
    const track = { number: 0, audio: false, codec: '', defaultDuration: 0 };
    let cursor = start;
    while (cursor + 2 <= end) {
      const el = readElement(cursor); if (!el || el.dataEnd > end) break;
      if (el.id === 0xd7) track.number = readUint(el.dataStart, el.dataEnd);
      if (el.id === 0x83) track.audio = readUint(el.dataStart, el.dataEnd) === 2;
      if (el.id === 0x86) track.codec = new TextDecoder().decode(bytes.subarray(el.dataStart, el.dataEnd));
      if (el.id === 0x23e383) track.defaultDuration = readUint(el.dataStart, el.dataEnd);
      if (master.has(el.id) && el.id !== 0xae) scan(el.dataStart, el.dataEnd);
      cursor = el.next;
    }
    return track;
  };
  // Walk top-level EBML and Segment elements; unknown-size Segment is supported.
  scan(0, bytes.length);
  if (declaredDuration > 0) return declaredDuration * timecodeScale / 1_000_000_000;
  const audioTracks = [...tracks.values()].filter((track) => track.audio && (track.codec === 'A_OPUS' || codec.toLowerCase().includes('opus')));
  if (!audioTracks.length) return 0;
  let maxNs = 0;
  for (const cluster of clusters) {
    let clusterTime = 0;
    let cursor = cluster.start;
    while (cursor + 2 <= cluster.end) {
      const el = readElement(cursor); if (!el || el.dataEnd > cluster.end) break;
      if (el.id === 0xe7) clusterTime = readUint(el.dataStart, el.dataEnd);
      let blockStart = -1; let blockEnd = -1; let explicitDuration = 0;
      if (el.id === 0xa3) { blockStart = el.dataStart; blockEnd = el.dataEnd; }
      if (el.id === 0xa0) {
        let inner = el.dataStart;
        while (inner + 2 <= el.dataEnd) {
          const child = readElement(inner); if (!child || child.dataEnd > el.dataEnd) break;
          if (child.id === 0xa1) { blockStart = child.dataStart; blockEnd = child.dataEnd; }
          if (child.id === 0x9b) explicitDuration = readUint(child.dataStart, child.dataEnd);
          inner = child.next;
        }
      }
      if (blockStart >= 0 && blockEnd - blockStart >= 4) {
        const trackVint = readVint(blockStart);
        if (trackVint) {
          const timeOffset = blockStart + trackVint.width;
          const trackNo = trackVint.value;
          const isAudio = audioTracks.some((track) => track.number === trackNo);
          if (isAudio && timeOffset + 3 <= blockEnd) {
            const relative = new DataView(bytes.buffer, bytes.byteOffset + timeOffset, 2).getInt16(0);
            const ticks = Math.max(0, clusterTime + relative);
            const packet = bytes.subarray(timeOffset + 3, blockEnd);
            const packetMs = opusPacketDurationMs(packet);
            const blockNs = explicitDuration ? explicitDuration * timecodeScale : audioTracks.find((track) => track.number === trackNo)?.defaultDuration ?? packetMs * 1_000_000;
            maxNs = Math.max(maxNs, ticks * timecodeScale + blockNs);
          }
        }
      }
      cursor = el.next;
    }
  }
  return maxNs > 0 ? maxNs / 1_000_000_000 : 0;
}

function opusPacketDurationMs(packet: Uint8Array): number {
  if (!packet.length) return 0;
  const config = packet[0] >> 3;
  const frameMs = config >= 16 ? [2.5, 5, 10, 20][config & 3] : config >= 12 ? [10, 20][config & 1] : [10, 20, 40, 60][config & 3];
  const code = packet[0] & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] & 0x3f) : 2;
  if (!Number.isFinite(frames) || frames < 1 || frames > 48) return 0;
  return Math.min(120, frameMs * frames);
}
