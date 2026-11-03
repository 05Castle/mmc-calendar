import { useRef } from "react";

const STAR_PATH =
  "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

// 0.5 단위 별점: 탭하거나 손가락을 좌우로 끌어서 채운다
export default function StarRating({ value, onChange }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  const valueFromX = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const v = Math.ceil(ratio * 10) / 2; // 0.5 단위로 올림
    return Math.min(5, Math.max(0.5, v));
  };

  const handleDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(valueFromX(e.clientX));
  };
  const handleMove = (e) => {
    if (dragging.current) onChange(valueFromX(e.clientX));
  };
  const handleUp = () => {
    dragging.current = false;
  };
  const handleKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, value + 0.5));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0.5, value - 0.5));
    }
  };

  return (
    <div
      ref={ref}
      className="game-stars"
      role="slider"
      tabIndex={0}
      aria-label="별점"
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={value || undefined}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.min(1, Math.max(0, value - i)); // 0 / 0.5 / 1
        return (
          <div key={i} className="game-star">
            <svg className="base" viewBox="0 0 24 24" aria-hidden="true">
              <path d={STAR_PATH} />
            </svg>
            <svg
              className="fill"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}
            >
              <path d={STAR_PATH} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
