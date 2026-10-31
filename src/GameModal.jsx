import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";

const GAMES_DOC = ["config", "games"];

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatPlayers(game) {
  return game.min === game.max ? `${game.min}명` : `${game.min}~${game.max}명`;
}

function sortGames(games, sortKey) {
  const byName = (a, b) => a.name.localeCompare(b.name, "ko");
  return games.slice().sort(
    sortKey === "players"
      ? (a, b) => a.min - b.min || a.max - b.max || byName(a, b)
      : byName,
  );
}

// 동시에 여러 명이 수정해도 덮어쓰지 않도록 트랜잭션으로 읽고-수정-저장
function updateGames(updater) {
  const ref = doc(db, ...GAMES_DOC);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().games || [] : [];
    tx.set(ref, { games: updater(current) });
  });
}

function DiceIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function GameButton({ onClick }) {
  return (
    <button
      type="button"
      className="game-btn"
      onClick={onClick}
      aria-label="게임 목록 보기"
    >
      <DiceIcon />
    </button>
  );
}

function Layer({ label, level = 1, small = false, children }) {
  // level 1: 게임 목록 모달 / level 2: 그 위에 뜨는 중첩 모달
  // 오버레이를 눌러도 닫히지 않는다 (버튼으로만 닫기)
  return (
    <>
      <div className={`game-overlay level-${level}`} />
      <div
        className={`game-modal level-${level} ${small ? "small" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </>
  );
}

export default function GameModal({ open, onClose }) {
  const [games, setGames] = useState(null); // null = 불러오는 중
  const [sortKey, setSortKey] = useState("name"); // "name" | "players"

  // 중첩 모달: 게임 추가
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [isRange, setIsRange] = useState(false);
  const [minPlayers, setMinPlayers] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);

  // 중첩 모달: 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // 게임 목록 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, ...GAMES_DOC),
      (snap) => setGames(snap.exists() ? snap.data().games || [] : []),
      () => setGames([]),
    );
    return () => unsub();
  }, []);

  // 모달이 열려 있는 동안 뒤 화면 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const openAdd = () => {
    setName("");
    setIsRange(false);
    setMinPlayers("");
    setMaxPlayers("");
    setAddError("");
    setAddOpen(true);
  };

  const closeAdd = () => {
    if (saving) return;
    setAddOpen(false);
  };

  const toggleRange = () => {
    setIsRange((r) => !r);
    setMaxPlayers("");
    setAddError("");
  };

  const handleAdd = async () => {
    const trimmed = name.trim();
    const min = Number(minPlayers);
    const max = isRange ? Number(maxPlayers) : min;

    if (!trimmed) return setAddError("게임 이름을 입력해주세요.");
    if (!Number.isInteger(min) || min < 1 || min > 99)
      return setAddError("인원수는 1~99 사이 숫자로 입력해주세요.");
    if (isRange && (!Number.isInteger(max) || max < 1 || max > 99))
      return setAddError("최대 인원수를 1~99 사이 숫자로 입력해주세요.");
    if (max < min) return setAddError("최대 인원이 최소 인원보다 작아요.");

    setSaving(true);
    setAddError("");
    try {
      await updateGames((current) => {
        const dup = current.some(
          (g) => g.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (dup) throw new Error("DUPLICATE");
        return [...current, { id: makeId(), name: trimmed, min, max }];
      });
      setAddOpen(false);
    } catch (e) {
      setAddError(
        e.message === "DUPLICATE"
          ? "이미 등록된 게임이에요."
          : "저장에 실패했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (game) => {
    setDeleteError("");
    setDeleteTarget(game);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await updateGames((current) =>
        current.filter((g) => g.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    } catch {
      setDeleteError("삭제에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  const sorted = games ? sortGames(games, sortKey) : [];
  const onEnter = (e) => e.key === "Enter" && handleAdd();

  return (
    <>
      {/* 1단계: 게임 목록 */}
      <Layer label="게임 목록" level={1}>
        <div className="game-modal-header">
          <h2 className="game-modal-title">
            게임 목록
            {games && <span className="game-count">{games.length}</span>}
          </h2>
          <button type="button" className="game-close-btn" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="game-sort">
          <button
            type="button"
            className={`game-sort-btn ${sortKey === "name" ? "active" : ""}`}
            onClick={() => setSortKey("name")}
          >
            ㄱㄴㄷ순
          </button>
          <button
            type="button"
            className={`game-sort-btn ${sortKey === "players" ? "active" : ""}`}
            onClick={() => setSortKey("players")}
          >
            인원수순
          </button>
        </div>

        <div className="game-list">
          {games === null ? (
            <p className="game-empty">불러오는 중…</p>
          ) : sorted.length === 0 ? (
            <p className="game-empty">등록된 게임이 없어요</p>
          ) : (
            sorted.map((game) => (
              <div key={game.id} className="game-item">
                <span className="game-item-name">{game.name}</span>
                <span className="game-item-players">{formatPlayers(game)}</span>
                <button
                  type="button"
                  className="game-delete-btn"
                  onClick={() => askDelete(game)}
                  aria-label={`${game.name} 삭제`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <button type="button" className="game-open-add-btn" onClick={openAdd}>
          + 게임 추가
        </button>
      </Layer>

      {/* 2단계: 게임 추가 */}
      {addOpen && (
        <Layer label="게임 추가" level={2} small>
          <h2 className="game-modal-title game-sub-title">게임 추가</h2>

          <div className="game-form">
            <input
              className="game-input"
              type="text"
              placeholder="게임 이름"
              value={name}
              maxLength={20}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
            />
            <div className="game-players-inputs">
              <input
                className="game-input game-input-num"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                placeholder={isRange ? "최소" : "인원"}
                value={minPlayers}
                onChange={(e) => setMinPlayers(e.target.value)}
                onKeyDown={onEnter}
              />
              {isRange && (
                <>
                  <span className="game-range-sep">~</span>
                  <input
                    className="game-input game-input-num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    placeholder="최대"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                    onKeyDown={onEnter}
                  />
                </>
              )}
              <span className="game-unit">명</span>
            </div>
            <label className="game-range-toggle">
              <input type="checkbox" checked={isRange} onChange={toggleRange} />
              인원을 범위로 입력 (예: 2~5명)
            </label>
            {addError && <p className="game-error">{addError}</p>}
          </div>

          <div className="game-actions">
            <button
              type="button"
              className="game-cancel-btn"
              onClick={closeAdd}
              disabled={saving}
            >
              취소
            </button>
            <button
              type="button"
              className="game-confirm-btn"
              onClick={handleAdd}
              disabled={saving}
            >
              추가
            </button>
          </div>
        </Layer>
      )}

      {/* 2단계: 삭제 확인 */}
      {deleteTarget && (
        <Layer label="게임 삭제 확인" level={2} small>
          <h2 className="game-modal-title game-sub-title">게임 삭제</h2>
          <p className="game-confirm-text">
            <strong>{deleteTarget.name}</strong> 게임을 삭제할까요?
          </p>
          {deleteError && <p className="game-error">{deleteError}</p>}
          <div className="game-actions">
            <button
              type="button"
              className="game-cancel-btn"
              onClick={closeDelete}
              disabled={deleting}
            >
              취소
            </button>
            <button
              type="button"
              className="game-confirm-btn danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              삭제
            </button>
          </div>
        </Layer>
      )}
    </>
  );
}
