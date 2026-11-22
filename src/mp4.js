// A small MP4 file writer for H.264 video + AAC audio, with nothing to install. The browser's VideoEncoder and AudioEncoder
// (WebCodecs) produce the compressed frames; this puts them into an .mp4 box structure that QuickTime, phones and LinkedIn play.
// Layout: ftyp, moov (all the timing tables), then one mdat holding every video frame followed by every audio frame.
const te = new TextEncoder();
const u8 = (...n) => Uint8Array.from(n);
const u16 = (n) => u8((n >> 8) & 255, n & 255);
const u32 = (n) => u8((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const str = (s) => te.encode(s);
const zeros = (n) => new Uint8Array(n);
const cat = (...parts) => {
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const box = (type, ...p) => { const body = cat(...p); return cat(u32(8 + body.length), str(type), body); };
const full = (type, version, flags, ...p) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...p);
const MATRIX = cat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));
const bytes = (d) => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d));

// sample durations as runs: (count, duration) pairs
function sttsBox(samples, delta) {
  if (samples.length === 0 || samples[0].dur === undefined) return full('stts', 0, 0, u32(1), u32(samples.length), u32(delta));
  const runs = [];
  for (const s of samples) { const d = Math.max(1, Math.round(s.dur)); const r = runs.at(-1); if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
  return full('stts', 0, 0, u32(runs.length), ...runs.flatMap(([c, d]) => [u32(c), u32(d)]));
}

export class Mp4Writer {
  // videoTimescale: when given, each video frame carries its own duration (dur, in those units) instead of 1/fps
  constructor({ width, height, fps, sampleRate, channels, videoTimescale }) {
    Object.assign(this, { width, height, fps, sampleRate, channels, videoTimescale, video: [], audio: [], avcC: null, asc: null });
  }
  addVideo(data, key, meta, dur) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) this.avcC = bytes(meta.decoderConfig.description).slice();
    this.video.push({ data, key, dur });
  }
  addAudio(data, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) this.asc = bytes(meta.decoderConfig.description).slice();
    this.audio.push({ data });
  }

  // timing tables shared by both tracks
  tables(samples, delta, chunkOffset, keyOnly) {
    const n = samples.length;
    const parts = [
      sttsBox(samples, delta),
      ...(keyOnly ? [full('stss', 0, 0, u32(samples.filter((s) => s.key).length), ...samples.map((s, i) => (s.key ? u32(i + 1) : null)).filter(Boolean))] : []),
      full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full('stsz', 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length))),
      full('stco', 0, 0, u32(1), u32(chunkOffset)),
    ];
    return parts;
  }

  moov(videoOffset, audioOffset) {
    const { width: w, height: h, fps, sampleRate: sr, channels } = this;
    const nV = this.video.length, nA = this.audio.length;
    const vts = this.videoTimescale || fps * 1000; // video timescale; without per-frame durations each frame lasts 1000 units
    const vUnits = this.video[0] && this.video[0].dur !== undefined ? this.video.reduce((t, v) => t + Math.max(1, Math.round(v.dur)), 0) : nV * 1000;
    const msV = Math.round((vUnits / vts) * 1000), msA = Math.round(((nA * 1024) / sr) * 1000), ms = Math.max(msV, msA);
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const lang = u16(0x55c4); // "und"

    const avc1 = box('avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(w), u16(h), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      zeros(32), u16(0x18), u16(0xffff), box('avcC', this.avcC));
    const videoTrak = box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(msV), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32((w * 65536) >>> 0), u32((h * 65536) >>> 0)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(vts), u32(vUnits), lang, u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler\0')),
        box('minf', full('vmhd', 0, 1, u16(0), zeros(6)), dinf,
          box('stbl', full('stsd', 0, 0, u32(1), avc1), ...this.tables(this.video, 1000, videoOffset, true)))));

    const asc = this.asc;
    const esds = full('esds', 0, 0,
      u8(0x03, 23 + asc.length, 0, 0, 0),
      u8(0x04, 15 + asc.length, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      u8(0x05, asc.length), asc,
      u8(0x06, 1, 2));
    const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32((sr * 65536) >>> 0), esds);
    const audioTrak = box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(2), u32(0), u32(msA), zeros(8), u16(0), u16(0), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(sr), u32(nA * 1024), lang, u16(0)),
        full('hdlr', 0, 0, u32(0), str('soun'), zeros(12), str('SoundHandler\0')),
        box('minf', full('smhd', 0, 0, u16(0), u16(0)), dinf,
          box('stbl', full('stsd', 0, 0, u32(1), mp4a), ...this.tables(this.audio, 1024, audioOffset, false)))));

    return box('moov',
      full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(3)),
      videoTrak, audioTrak);
  }

  finish() {
    if (!this.avcC) throw new Error('no video description from the encoder');
    if (!this.asc) throw new Error('no audio description from the encoder');
    const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    const vBytes = this.video.reduce((a, s) => a + s.data.length, 0);
    const first = this.moov(0, 0); // only to learn how big the moov box is
    const base = ftyp.length + first.length + 8; // 8 = the mdat header
    const moov = this.moov(base, base + vBytes);
    const mdatBody = cat(...this.video.map((s) => s.data), ...this.audio.map((s) => s.data));
    return cat(ftyp, moov, u32(8 + mdatBody.length), str('mdat'), mdatBody);
  }
}
