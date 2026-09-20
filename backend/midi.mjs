// Standard MIDI File (SMF) helpers for the "MIDI로 내보내기" note editor.
//
// MuScriptor (audio.cpp) only goes audio -> symbolic notes; there is no notes -> MIDI
// encoder anywhere else in this stack, so encodeMidiFile() hand-rolls just enough of the
// SMF spec (format 0, a single track, variable-length delta-times) to round-trip an
// edited note list back into a standard, DAW-openable .mid file.

// General MIDI program numbers (0-indexed) for the instrument tags MuScriptor emits.
// Unknown tags fall back to Acoustic Grand Piano (0).
const GM_PROGRAMS = {
  acoustic_piano: 0, electric_piano: 4, harpsichord: 6, clavinet: 7,
  acoustic_guitar: 24, electric_guitar: 27, electric_bass: 33, bass: 32,
  violin: 40, viola: 41, cello: 42, contrabass: 43, strings: 48, string_ensemble: 48,
  orchestra_hit: 55, trumpet: 56, trombone: 57, tuba: 58, french_horn: 60,
  sax: 65, alto_sax: 65, tenor_sax: 66, oboe: 68, bassoon: 70, clarinet: 71, flute: 73,
  synth_lead: 80, synth_pad: 88, voice: 52, choir: 52,
  organ: 19, accordion: 21, harmonica: 22,
};
const DRUM_INSTRUMENTS = new Set(['drums', 'percussion', 'drum_kit']);
const DEFAULT_INSTRUMENT = 'acoustic_piano';

function writeVarLen(value) {
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return Buffer.from(bytes.reverse());
}

function uint32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }
function uint16be(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff, 0); return b; }

// MuScriptor's --text-out JSON is a stream of paired start/end events (an "end" event
// references its "start" via start_event_index) rather than a flat note list -- this
// reassembles it into the {id, pitch, start, end, instrument} shape the piano-roll editor
// and encodeMidiFile() both use.
export function parseNoteEvents(rawEvents) {
  const starts = new Map();
  const notes = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (event.type === 'start') {
      starts.set(event.index, { pitch: event.pitch, start: event.start_time, instrument: event.instrument || DEFAULT_INSTRUMENT });
    } else if (event.type === 'end') {
      const started = starts.get(event.start_event_index);
      if (started) notes.push({ pitch: started.pitch, start: started.start, end: event.end_time, instrument: started.instrument });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes.map((note, index) => ({ id: index, ...note }));
}

export function encodeMidiFile(notes, { ppq = 480, bpm = 120 } = {}) {
  const microsecondsPerQuarter = Math.max(1, Math.round(60000000 / bpm));
  const ticksPerSecond = (ppq * bpm) / 60;

  const instruments = [...new Set((notes || []).map((note) => note.instrument || DEFAULT_INSTRUMENT))];
  const channelFor = {};
  let nextChannel = 0;
  for (const instrument of instruments) {
    if (DRUM_INSTRUMENTS.has(instrument)) { channelFor[instrument] = 9; continue; }
    if (nextChannel === 9) nextChannel += 1; // channel 9 is reserved for GM percussion
    channelFor[instrument] = nextChannel % 16;
    nextChannel += 1;
  }

  // priority breaks ties at the same tick: tempo -> program changes -> note-offs -> note-ons
  // (note-offs before note-ons avoids a spurious retrigger when one note ends exactly as
  // another begins on the same pitch/channel).
  const events = [{
    tick: 0,
    priority: 0,
    bytes: Buffer.concat([Buffer.from([0xff, 0x51, 0x03]), Buffer.from([(microsecondsPerQuarter >> 16) & 0xff, (microsecondsPerQuarter >> 8) & 0xff, microsecondsPerQuarter & 0xff])]),
  }];
  for (const instrument of instruments) {
    const channel = channelFor[instrument];
    if (channel === 9) continue; // GM percussion needs no program change
    events.push({ tick: 0, priority: 1, bytes: Buffer.from([0xc0 | channel, GM_PROGRAMS[instrument] ?? 0]) });
  }
  for (const note of notes || []) {
    const channel = channelFor[note.instrument || DEFAULT_INSTRUMENT] ?? 0;
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const startTick = Math.max(0, Math.round(note.start * ticksPerSecond));
    const endTick = Math.max(startTick + 1, Math.round(note.end * ticksPerSecond));
    events.push({ tick: startTick, priority: 3, bytes: Buffer.from([0x90 | channel, pitch, 100]) });
    events.push({ tick: endTick, priority: 2, bytes: Buffer.from([0x80 | channel, pitch, 0]) });
  }
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);

  const trackChunks = [];
  let lastTick = 0;
  for (const event of events) {
    trackChunks.push(writeVarLen(event.tick - lastTick));
    trackChunks.push(event.bytes);
    lastTick = event.tick;
  }
  trackChunks.push(writeVarLen(0), Buffer.from([0xff, 0x2f, 0x00])); // end of track

  const trackData = Buffer.concat(trackChunks);
  const header = Buffer.concat([Buffer.from('MThd'), uint32be(6), uint16be(0), uint16be(1), uint16be(ppq)]);
  const track = Buffer.concat([Buffer.from('MTrk'), uint32be(trackData.length), trackData]);
  return Buffer.concat([header, track]);
}
