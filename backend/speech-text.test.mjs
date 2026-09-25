import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpeechText, sinoNumber, nativeNumber } from './speech-text.mjs';

test('Sino-Korean and native numbers', () => {
  assert.deepEqual([0, 7, 10, 23, 100, 2024, 2026, 10000, 12345, 100000000].map(sinoNumber), ['영', '칠', '십', '이십삼', '백', '이천이십사', '이천이십육', '만', '만이천삼백사십오', '일억']);
  assert.deepEqual([1, 2, 3, 10, 12, 20, 21, 35, 99].map(nativeNumber), ['한', '두', '세', '열', '열두', '스무', '스물한', '서른다섯', '아흔아홉']);
});

test('digits and capital abbreviations in Korean sentences are written out in Hangul', () => {
  assert.equal(normalizeSpeechText('지금부터 TTS 음성 테스트를 시작하겠습니다.'), '지금부터 티티에스 음성 테스트를 시작하겠습니다.');
  assert.equal(normalizeSpeechText('최근 AI 기술이 빠르게 발전했습니다.'), '최근 에이아이 기술이 빠르게 발전했습니다.');
  assert.equal(normalizeSpeechText('2024년부터 2026년까지 성장했다.'), '이천이십사년부터 이천이십육년까지 성장했다.');
  assert.equal(normalizeSpeechText('기온은 섭씨 23도, 습도는 45%입니다.'), '기온은 섭씨 이십삼도, 습도는 사십오 퍼센트입니다.');
  assert.equal(normalizeSpeechText('3시에 5명이 12개를 샀다.'), '세 시에 다섯 명이 열두 개를 샀다.');
  assert.equal(normalizeSpeechText('가격은 1,500원이고 비율은 3.14입니다.'), '가격은 천오백원이고 비율은 삼 점 일 사입니다.');
  assert.equal(normalizeSpeechText('전화는 010에 걸어 주세요.'), '전화는 공일공에 걸어 주세요.');
  assert.equal(normalizeSpeechText('OK 좋아요, 그리고 GPU도 있어요.'), '오케이 좋아요, 그리고 지피유도 있어요.');
});

test('English words, lowercase terms and pure English sentences are left alone', () => {
  assert.equal(normalizeSpeechText('machine learning과 deep learning에 관심이 있습니다.'), 'machine learning과 deep learning에 관심이 있습니다.');
  assert.equal(normalizeSpeechText('In 2024 the AI market grew. 그리고 3명이 왔다.'), 'In 2024 the AI market grew. 그리고 세 명이 왔다.');
  assert.equal(normalizeSpeechText('Hello 2 world'), 'Hello 2 world');
});
