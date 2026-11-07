import { DUO_MEMBERS, useLongPress } from "./duo";

// 이름 선택창의 이름 버튼. 2인 모드 멤버의 이름은 길게 누르면 onDuo가 호출된다.
export default function SheetNameButton({ name, active, onSelect, onDuo }) {
  const isDuo = DUO_MEMBERS.includes(name);
  const press = useLongPress(onDuo);

  return (
    <button
      className={`sheet-name-btn ${active ? "active" : ""}`}
      {...(isDuo ? press.handlers : { onContextMenu: (e) => e.preventDefault() })}
      onClick={() => {
        // 길게 누르기가 발동된 뒤 손을 뗄 때 따라오는 클릭은 이름 선택으로 치지 않는다
        if (isDuo && press.consumeClick()) return;
        onSelect(name);
      }}
    >
      {name}
    </button>
  );
}
