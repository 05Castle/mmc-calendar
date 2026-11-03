// 게임 입력 규칙과 공용 헬퍼 (게임 모달 / admin 페이지가 함께 사용)
export const MAX_NAME_LENGTH = 40;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 9;

// ===== 검색 =====
// 대소문자·띄어쓰기·특수문자를 무시하고, 한글은 초성만 입력해도 찾는다 (예: ㅁㄷㅁㅅ)
const CHOSUNG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

// 이름 비교용: 대소문자·띄어쓰기·특수문자를 없앤 형태
export function normalizeName(str) {
  return str.toLowerCase().replace(/[\s\-_:'’".,!?·&]/g, "");
}

function toChosung(str) {
  return [...str]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0xac00 && code <= 0xd7a3
        ? CHOSUNG[Math.floor((code - 0xac00) / 588)]
        : ch;
    })
    .join("");
}

export function matchesQuery(name, query) {
  const q = normalizeName(query);
  if (!q) return true;
  const n = normalizeName(name);
  if (n.includes(q)) return true;
  return /^[ㄱ-ㅎ]+$/.test(q) && toChosung(n).includes(q);
}
