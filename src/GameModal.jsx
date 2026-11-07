import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { MAX_NAME_LENGTH, normalizeName, matchesQuery } from "./gameRules";
import StarRating from "./StarRating";

// 저장소: 전체 모드와 2인 모드는 서로 완전히 별개의 문서를 쓴다
const STORES = {
  normal: { key: "normal", games: ["config", "games"], played: ["config", "played"] },
  duo: { key: "duo", games: ["config", "duoGames"], played: ["config", "duoPlayed"] },
};

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatPlayers(game) {
  return game.min === game.max ? `${game.min}명` : `${game.min}~${game.max}명`;
}

function sortGames(games, sortKey) {
  const byName = (a, b) => a.name.localeCompare(b.name, "ko");
  return games
    .slice()
    .sort(
      sortKey === "players"
        ? (a, b) => a.min - b.min || a.max - b.max || byName(a, b)
        : byName,
    );
}

// 동시에 여러 명이 수정해도 덮어쓰지 않도록 트랜잭션으로 읽고-수정-저장
function updateGames(store, updater) {
  const ref = doc(db, ...store.games);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().games || [] : [];
    tx.set(ref, { games: updater(current) });
  });
}

// 플레이 완료: 게임 목록에서 제거 + 플레이 기록 추가를 한 트랜잭션으로 처리
// 전체 모드 기록에는 인원수가 함께 남고, 2인 모드 기록은 이름과 별점만 남는다
function markPlayed(store, game, rating) {
  const gamesRef = doc(db, ...store.games);
  const playedRef = doc(db, ...store.played);
  return runTransaction(db, async (tx) => {
    const gSnap = await tx.get(gamesRef);
    const pSnap = await tx.get(playedRef);
    const current = gSnap.exists() ? gSnap.data().games || [] : [];
    const target = current.find((g) => g.id === game.id);
    if (!target) return; // 다른 사람이 이미 처리함 → 기록 중복 방지
    const records = pSnap.exists() ? pSnap.data().records || [] : [];
    const record = { id: target.id, name: target.name };
    if (store.key === "normal") {
      record.min = target.min;
      record.max = target.max;
    }
    record.rating = rating; // 0.5 단위 숫자, 건너뛰면 null
    tx.set(gamesRef, { games: current.filter((g) => g.id !== game.id) });
    tx.set(playedRef, { records: [...records, record] });
  });
}

function DiceIcon() {
  // 등각 투영(isometric) 입체 주사위: 윗면 / 왼쪽면 / 오른쪽면
  const pip = { fill: "var(--surface)" };
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 면: 위가 가장 밝고 오른쪽이 가장 어둡게 */}
      <polygon points="12,2 20.66,7 12,12 3.34,7" fillOpacity="1" />
      <polygon points="3.34,7 12,12 12,22 3.34,17" fillOpacity="0.72" />
      <polygon points="12,12 20.66,7 20.66,17 12,22" fillOpacity="0.45" />
      {/* 눈: 윗면 1, 왼쪽 2, 오른쪽 3 */}
      <g stroke="none" style={pip}>
        <circle cx="12" cy="7" r="1.1" />
        <circle cx="5.9" cy="11.4" r="1" />
        <circle cx="9.4" cy="17.4" r="1" />
        <circle cx="14.2" cy="13.3" r="1" />
        <circle cx="16.3" cy="14.5" r="1" />
        <circle cx="18.5" cy="15.8" r="1" />
      </g>
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

function Layer({
  label,
  level = 1,
  small = false,
  closing = false,
  onClosed,
  onClose, // level 1 전용: 시트 위에 떠 있는 닫기 버튼
  children,
}) {
  // 오버레이를 눌러도 닫히지 않는다 (닫기 버튼으로만 닫기)
  const overlay = (
    <div className={`game-overlay level-${level} ${closing ? "closing" : ""}`} />
  );

  // level 1: 하단 시트 (시트 + 위에 떠 있는 닫기 버튼이 함께 움직인다)
  if (level === 1) {
    return (
      <>
        {overlay}
        <div
          className={`game-sheet ${closing ? "closing" : ""}`}
          onAnimationEnd={(e) => {
            if (closing && e.target === e.currentTarget) onClosed?.();
          }}
        >
          <button
            type="button"
            className="game-float-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
          <div
            className="game-modal level-1"
            role="dialog"
            aria-modal="true"
            aria-label={label}
          >
            {children}
          </div>
        </div>
      </>
    );
  }

  // level 2: 화면 중앙 팝업
  return (
    <>
      {overlay}
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

export default function GameModal({ open, onClose, duo = false }) {
  const store = duo ? STORES.duo : STORES.normal;
  // 불러온 데이터가 어느 저장소의 것인지 함께 기억 (모드가 바뀌면 이전 데이터를 보여주지 않음)
  const [gamesData, setGamesData] = useState({ key: null, list: null });
  const [playedData, setPlayedData] = useState({ key: null, list: null });
  const games = gamesData.key === store.key ? gamesData.list : null; // null = 불러오는 중
  const played = playedData.key === store.key ? playedData.list : null;
  const [sortKey, setSortKey] = useState("name"); // "name" | "players"
  const [closing, setClosing] = useState(false); // 닫힘 애니메이션 중
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("owned"); // "owned" | "played"
  const listRef = useRef(null); // 목록 스크롤 영역

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
  const [deleteStep, setDeleteStep] = useState("choose"); // "choose" | "rate"
  const [rating, setRating] = useState(0); // 0 = 아직 선택 안 함
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // 게임 목록 실시간 구독 (모드가 바뀌면 다른 문서를 구독)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, ...store.games),
      (snap) =>
        setGamesData({
          key: store.key,
          list: snap.exists() ? snap.data().games || [] : [],
        }),
      () => setGamesData({ key: store.key, list: [] }),
    );
    return () => unsub();
  }, [store.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 플레이 완료 기록 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, ...store.played),
      (snap) =>
        setPlayedData({
          key: store.key,
          list: snap.exists() ? snap.data().records || [] : [],
        }),
      () => setPlayedData({ key: store.key, list: [] }),
    );
    return () => unsub();
  }, [store.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭·정렬·검색어가 바뀌면 목록을 맨 위로 (실시간 데이터 갱신 때는 건드리지 않음)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [tab, sortKey, query]);

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

  const requestClose = () => setClosing(true);
  const finishClose = () => {
    setClosing(false);
    setQuery("");
    setTab("owned");
    onClose();
  };

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

  const selectMode = (range) => {
    if (range === isRange) return;
    setIsRange(range);
    setMaxPlayers("");
    setAddError("");
  };

  const handleAdd = async () => {
    const trimmed = name.trim();
    const min = Number(minPlayers);
    const max = isRange ? Number(maxPlayers) : min;

    if (!trimmed) return setAddError("게임 이름을 입력해주세요.");
    // 2인 모드는 인원수를 받지 않는다
    if (!duo) {
      if (!Number.isInteger(min) || min < 1 || min > 9)
        return setAddError("인원수는 1~9 사이 숫자로 입력해주세요.");
      if (isRange && (!Number.isInteger(max) || max < 1 || max > 9))
        return setAddError("최대 인원수를 1~9 사이 숫자로 입력해주세요.");
      if (max < min) return setAddError("최대 인원이 최소 인원보다 작아요.");
    }

    setSaving(true);
    setAddError("");
    try {
      await updateGames(store, (current) => {
        const dup = current.some(
          (g) => g.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (dup) throw new Error("DUPLICATE");
        const game = duo
          ? { id: makeId(), name: trimmed }
          : { id: makeId(), name: trimmed, min, max };
        return [...current, game];
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
    setDeleteStep("choose");
    setRating(0);
    setDeleteTarget(game);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };

  const goRate = () => {
    setDeleteError("");
    setRating(0);
    setDeleteStep("rate");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await updateGames(store, (current) =>
        current.filter((g) => g.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
    } catch {
      setDeleteError("삭제에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  const handlePlayed = async (value) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await markPlayed(store, deleteTarget, value);
      setDeleteTarget(null);
    } catch {
      setDeleteError("저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  const searching = normalizeName(query) !== "";
  // 2인 모드에는 인원수가 없어서 이름순으로만 정렬한다
  const effectiveSort = duo ? "name" : sortKey;
  const visibleFilter = (item) => matchesQuery(item.name, query);
  const ownedList = games
    ? sortGames(games.filter(visibleFilter), effectiveSort)
    : [];
  const playedList = played
    ? sortGames(played.filter(visibleFilter), effectiveSort)
    : [];
  const visibleList = tab === "owned" ? ownedList : playedList;
  const otherCount = tab === "owned" ? playedList.length : ownedList.length;
  const onEnter = (e) => e.key === "Enter" && handleAdd();

  return (
    <>
      {/* 1단계: 게임 목록 */}
      <Layer
        label="게임 목록"
        level={1}
        closing={closing}
        onClosed={finishClose}
        onClose={requestClose}
      >
        <div className="game-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "owned"}
            className={`game-tab ${tab === "owned" ? "active" : ""}`}
            onClick={() => setTab("owned")}
          >
            보유 중 <span>{ownedList.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "played"}
            className={`game-tab ${tab === "played" ? "active" : ""}`}
            onClick={() => setTab("played")}
          >
            플레이 완료 <span>{playedList.length}</span>
          </button>
        </div>

        <div className="game-body">
        <div className="game-search">
          <input
            className="game-search-input"
            type="text"
            placeholder="게임 검색 (초성도 가능)"
            value={query}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          {query && (
            <button
              type="button"
              className="game-search-clear"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              ✕
            </button>
          )}
        </div>

        {!duo && (
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
        )}

        <div className="game-list" ref={listRef}>
          {games === null || played === null ? (
            <p className="game-empty">불러오는 중…</p>
          ) : visibleList.length === 0 ? (
            <p className="game-empty">
              {searching
                ? "일치하는 게임이 없어요"
                : tab === "owned"
                  ? "보유 중인 게임이 없어요"
                  : "플레이한 기록이 없어요"}
              {searching && otherCount > 0 && (
                <span className="game-empty-hint">
                  {tab === "owned" ? "플레이 완료" : "보유 중"} 탭에{" "}
                  {otherCount}개 있어요
                </span>
              )}
            </p>
          ) : tab === "owned" ? (
            ownedList.map((game) => (
              <div key={game.id} className="game-item">
                <span className="game-item-name">{game.name}</span>
                {!duo && (
                  <span className="game-item-players">{formatPlayers(game)}</span>
                )}
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
          ) : (
            playedList.map((rec) => (
              <div key={rec.id} className="game-item">
                <span className="game-item-name">{rec.name}</span>
                {!duo && (
                  <span className="game-item-players">{formatPlayers(rec)}</span>
                )}
                <span className="game-item-rating">
                  {rec.rating != null ? `★ ${rec.rating.toFixed(1)}` : ""}
                </span>
              </div>
            ))
          )}
        </div>

        {tab === "owned" && (
          <button type="button" className="game-open-add-btn" onClick={openAdd}>
            + 게임 추가
          </button>
        )}
        </div>
      </Layer>

      {/* 2단계: 게임 추가 */}
      {addOpen && (
        <Layer label="게임 추가" level={2} small>
          <div className="game-form">
            <input
              className="game-input"
              type="text"
              placeholder="게임 이름"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
            />
            {!duo && (
              <>
            <div className="game-mode-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!isRange}
                className={`game-mode-tab ${!isRange ? "active" : ""}`}
                onClick={() => selectMode(false)}
              >
                단일 인원
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isRange}
                className={`game-mode-tab ${isRange ? "active" : ""}`}
                onClick={() => selectMode(true)}
              >
                인원 범위
              </button>
            </div>
            <div className="game-players-inputs">
              <input
                className="game-input game-input-num"
                type="number"
                inputMode="numeric"
                min={1}
                max={9}
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
                    max={9}
                    placeholder="최대"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                    onKeyDown={onEnter}
                  />
                </>
              )}
              <span className="game-unit">명</span>
            </div>
              </>
            )}
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

      {/* 2단계: 게임 정리 (플레이 완료 / 삭제) */}
      {deleteTarget && (
        <Layer label="게임 정리" level={2} small>
          {deleteStep === "choose" ? (
            <>
              <h2 className="game-modal-title">
                <p>
                  <strong>{deleteTarget.name}</strong> 게임을 어떻게 할까요?
                </p>
              </h2>

              <p className="game-hint">
                플레이 완료: 기록으로 남기고 목록에서 제거
                <br />
                삭제: 기록 없이 제거 (잘못 등록·구매 취소)
              </p>
              {deleteError && <p className="game-error">{deleteError}</p>}
              <div className="game-choice">
                <button
                  type="button"
                  className="game-confirm-btn game-played-btn"
                  onClick={goRate}
                  disabled={deleting}
                >
                  플레이 완료
                </button>
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
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="game-back-btn"
                onClick={() => setDeleteStep("choose")}
                disabled={deleting}
              >
                ‹ 뒤로
              </button>
              <h2 className="game-modal-title game-sub-title">플레이 완료</h2>
              <p className="game-confirm-text">
                <strong>{deleteTarget.name}</strong>은(는) 어땠나요?
              </p>
              <StarRating value={rating} onChange={setRating} />
              <p className={`game-rating-value ${rating ? "" : "empty"}`}>
                {rating ? rating.toFixed(1) : "별을 눌러 점수를 매겨주세요"}
              </p>
              {deleteError && <p className="game-error">{deleteError}</p>}
              <div className="game-actions">
                <button
                  type="button"
                  className="game-cancel-btn"
                  onClick={() => handlePlayed(null)}
                  disabled={deleting}
                >
                  건너뛰기
                </button>
                <button
                  type="button"
                  className="game-confirm-btn"
                  onClick={() => handlePlayed(rating)}
                  disabled={deleting || !rating}
                >
                  저장
                </button>
              </div>
            </>
          )}
        </Layer>
      )}
    </>
  );
}
