// Tests of the lyric-to-recognizer matching (backend/lyricsync.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricLines, detectLanguage, alignLyrics, toLrc } from './lyricsync.mjs';

const word = (text, start, end) => ({ word: text, start_sample: Math.round(start * 16000), end_sample: Math.round(end * 16000) });

test('lyric lines drop section tags and blank lines; language follows the dominant script', () => {
  assert.deepEqual(lyricLines('[Intro]\n[Spoken - low]\nWho\nare you?\n\n[Verse 1]\nThe world\n'), ['Who', 'are you?', 'The world']);
  assert.equal(detectLanguage('세상은 비밀로 가득 차 있어'), 'ko');
  assert.equal(detectLanguage('世界は秘密で満ちている'), 'ja');
  assert.equal(detectLanguage('カーテンの向こうの世界 world'), 'ja');
  assert.equal(detectLanguage('The world is full of secrets'), 'en');
  assert.equal(detectLanguage('世界充满秘密'), 'zh');
});

test('every lyric line gets the time of the words the recognizer heard, even with recognition errors and extra sounds', () => {
  const lines = ['The world', 'is full of secrets', 'Those with eyes will see', 'Can you hear'];
  // the recognizer missed line 1, misspelled "secrets", and inserted "hmm" before line 3
  const heard = [word('is', 10, 10.3), word('full', 10.3, 10.6), word('of', 10.6, 10.8), word('secret', 10.8, 11.4), word('Hmm', 13, 13.5), word('Those', 14, 14.4), word('with', 14.4, 14.6), word('eyes', 14.6, 15), word('will', 15, 15.2), word('see', 15.2, 15.6), word('Can', 20, 20.3), word('you', 20.3, 20.5), word('hear', 20.5, 21)];
  const { lines: out, coverage } = alignLyrics(lines, heard);
  assert.equal(out.length, 4);
  assert.ok(Math.abs(out[1].start - 10.03) < 0.2, String(out[1].start));
  assert.ok(Math.abs(out[2].start - 14.1) < 0.3, String(out[2].start));
  assert.ok(Math.abs(out[3].start - 20.1) < 0.3, String(out[3].start));
  // the missed first line is estimated before the first heard one, never after it
  assert.equal(out[0].estimated, true);
  assert.ok(out[0].start < out[1].start && out[0].start >= 0);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i].start >= out[i - 1].start, 'times only move forward');
  assert.ok(coverage > 0.8 && coverage < 1);
  // per-word times exist and stay inside the line
  assert.equal(out[2].words.length, 5);
  assert.ok(out[2].words.every((w) => w.start >= out[2].start - 1e-6 && w.start <= out[2].end + 1e-6));
  assert.ok(out[2].confidence >= 0.99);
});

test('a line the recognizer skipped in the middle is placed between its neighbours', () => {
  const lines = ['aaa bbb', 'ccc ddd', 'eee fff'];
  const heard = [word('aaa', 1, 1.5), word('bbb', 1.5, 2), word('eee', 9, 9.5), word('fff', 9.5, 10)];
  const out = alignLyrics(lines, heard).lines;
  assert.equal(out[1].estimated, true);
  assert.ok(out[1].start > out[0].start && out[1].start < out[2].start);
});

test('Korean and Japanese lyrics (no spaces in Japanese) align character by character', () => {
  const ko = alignLyrics(['세상은', '비밀로 가득 차 있어'], [word('세상은', 3, 4), word('비밀로', 5, 5.6), word('가득', 5.6, 6), word('차', 6, 6.2), word('있어', 6.2, 6.8)]);
  assert.equal(ko.coverage, 1);
  assert.ok(Math.abs(ko.lines[1].start - 5.1) < 0.2);
  const ja = alignLyrics(['世界は', '秘密で満ちている'], [word('世界は', 28, 29), word('秘密で', 29.5, 30.3), word('満ちている', 30.3, 31.5)]);
  assert.ok(ja.coverage > 0.95);
  assert.ok(Math.abs(ja.lines[1].start - 29.6) < 0.3);
});

test('nothing to match against is an error, and LRC output has one stamped line per lyric line', () => {
  assert.throws(() => alignLyrics(['hello'], []), /인식된/);
  assert.throws(() => alignLyrics([], [word('a', 0, 1)]), /인식된/);
  const result = alignLyrics(['hello world', 'good night'], [word('hello', 61.5, 62), word('world', 62, 62.5), word('good', 70, 70.4), word('night', 70.4, 71)]);
  const lrc = toLrc(result, { title: '제목', durationMs: 125000 });
  assert.match(lrc, /^\[ti:제목\]\n\[length:02:05\]\n\[01:01\.\d\d\]hello world\n\[01:10\.\d\d\]good night\n$/);
});
