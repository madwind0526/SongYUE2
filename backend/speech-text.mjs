// Text preparation for Korean speech models: digits and capital-letter abbreviations are written out in Hangul so
// the model reads "2024년" as "이천이십사 년" and "AI" as "에이아이" (models tend to skip or garble them otherwise).
// Only sentences that contain Hangul are changed; pure English sentences are left as they are.

const SINO = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const BIG_UNITS = ['', '만', '억', '조'];
const NATIVE_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
const LETTERS = { A: '에이', B: '비', C: '씨', D: '디', E: '이', F: '에프', G: '지', H: '에이치', I: '아이', J: '제이', K: '케이', L: '엘', M: '엠', N: '엔', O: '오', P: '피', Q: '큐', R: '알', S: '에스', T: '티', U: '유', V: '브이', W: '더블유', X: '엑스', Y: '와이', Z: '제트' };
// Abbreviations that are spoken as words, not letter by letter.
const ACRONYM_WORDS = { OK: '오케이', NASA: '나사', UFO: '유에프오', LED: '엘이디', PDF: '피디에프' };

// 1234 -> 천이백삼십사 (a leading 일 is dropped before 십/백/천, and before 만 for 10000).
export function sinoNumber(value) {
  let digits = String(value).replace(/^0+(?=\d)/, '');
  if (digits === '0') return SINO[0];
  if (digits.length > 16) return [...digits].map((digit) => SINO[Number(digit)]).join('');
  let result = '';
  const groups = [];
  while (digits.length) { groups.unshift(digits.slice(-4)); digits = digits.slice(0, -4); }
  groups.forEach((group, index) => {
    const unit = BIG_UNITS[groups.length - 1 - index];
    let spoken = '';
    [...group.padStart(4, '0')].forEach((digit, position) => {
      const n = Number(digit);
      if (!n) return;
      const small = SMALL_UNITS[3 - position];
      spoken += (n === 1 && small ? '' : SINO[n]) + small;
    });
    if (spoken) result += (spoken === '일' && unit === '만' ? '' : spoken) + unit;
  });
  return result;
}

// 1..99 -> 한, 두, 세 ... 스무 (before a counter); larger numbers fall back to Sino-Korean.
export function nativeNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 99) return sinoNumber(value);
  if (n === 20) return '스무';
  return `${NATIVE_TENS[Math.floor(n / 10)]}${NATIVE_ONES[n % 10]}`;
}

const spellLetters = (word) => [...word].map((letter) => LETTERS[letter] || letter).join('');

function normalizeSentence(sentence) {
  if (!/[가-힣]/.test(sentence)) return sentence;
  let result = sentence.replace(/(?<![A-Za-z])[A-Z]{2,8}(?![A-Za-z])/g, (word) => ACRONYM_WORDS[word] || spellLetters(word));
  // counters that take native numbers (한 시, 두 개, 세 명), longest first so "시간" wins over "시"
  result = result.replace(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|℃|°C)?(?![\d])(\s?)(시간|개월|시|개|명|살|마리|잔|병|권|곳|가지)?/g, (match, whole, fraction, mark, space, counter) => {
    const integer = whole.replace(/,/g, '');
    let spoken;
    if (counter && !fraction) spoken = nativeNumber(integer);
    else if (/^0\d/.test(integer) && !fraction) spoken = [...integer].map((digit) => (digit === '0' ? '공' : SINO[Number(digit)])).join('');
    else spoken = sinoNumber(integer);
    if (fraction) spoken += ` 점 ${[...fraction].map((digit) => SINO[Number(digit)]).join(' ')}`;
    if (mark === '%') spoken += ' 퍼센트';
    else if (mark) spoken += ' 도';
    return counter ? `${spoken} ${counter}` : `${spoken}${mark ? '' : space}`;
  });
  return result;
}

// Sentence by sentence, so an English sentence next to a Korean one keeps its digits.
export function normalizeSpeechText(input) {
  return String(input || '').split(/([.!?。！？]\s+|\n)/).map((piece, index) => (index % 2 ? piece : normalizeSentence(piece))).join('');
}
