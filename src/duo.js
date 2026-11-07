import { useRef, useEffect } from "react";

// 2인(벙개) 모드 규칙
export const DUO_MEMBERS = ["세원", "오성"];
export const DUO_HOLD_MS = 2500; // 이만큼 누르고 있으면 길게 누르기로 인정

// 두 사람이 모두 투표한 날짜 (날짜순)
export function getDuoCommonDates(allVotes) {
  return Object.entries(allVotes)
    .filter(([, voters]) => DUO_MEMBERS.every((m) => voters.includes(m)))
    .map(([date]) => date)
    .sort();
}

// 길게 누르기: ms 동안 누르고 있으면 onFire({x, y})가 호출된다.
// 손가락이 많이 움직이거나(스크롤 등) 중간에 떼면 취소된다.
// 반환값 handlers 를 요소에 펼쳐 쓰고, onClick 안에서 consumeClick()으로
// "길게 누르기가 발동된 뒤 손을 뗄 때 따라오는 클릭"을 걸러낸다.
export function useLongPress(onFire, ms = DUO_HOLD_MS) {
  const timer = useRef(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const fire = useRef(onFire);
  // 최신 콜백을 유지 (렌더 중이 아니라 렌더 뒤에 갱신)
  useEffect(() => {
    fire.current = onFire;
  });

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };

  // 화면에서 사라질 때 대기 중인 타이머 정리
  useEffect(() => () => clearTimeout(timer.current), []);

  const handlers = {
    onPointerDown: (e) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        fire.current(start.current);
      }, ms);
    },
    onPointerMove: (e) => {
      if (!timer.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 12)
        clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e) => e.preventDefault(),
  };

  const consumeClick = () => {
    const was = fired.current;
    fired.current = false;
    return was;
  };

  return { handlers, consumeClick };
}
