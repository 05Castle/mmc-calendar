import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, runTransaction } from "firebase/firestore";
import StarRating from "./StarRating";
import {
  MAX_NAME_LENGTH,
  MIN_PLAYERS,
  MAX_PLAYERS,
  normalizeName,
  matchesQuery,
} from "./gameRules";

function formatPlayers(r) {
  return r.min === r.max ? `${r.min}명` : `${r.min}~${r.max}명`;
}

// 항상 최신 기록을 읽어서 고친 뒤 저장 (동시에 수정해도 덮어쓰지 않도록 트랜잭션 사용)
function updatePlayed(updater) {
  const ref = doc(db, "config", "played");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const records = snap.exists() ? snap.data().records || [] : [];
    tx.set(ref, { records: updater(records) });
  });
}

export default function PlayedRecordsAdmin({ records }) {
  const [query, setQuery] = useState("");
  const [onlyUnrated, setOnlyUnrated] = useState(false);
  const [msg, setMsg] = useState("");

  // 수정 팝업
  const [editing, setEditing] = useState(null); // 수정 중인 기록
  const [step, setStep] = useState("edit"); // "edit" | "delete"
  const [name, setName] = useState("");
  const [isRange, setIsRange] = useState(false);
  const [minPlayers, setMinPlayers] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [rating, setRating] = useState(null); // 0.5 단위 숫자 또는 null
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 팝업이 열려 있는 동안 뒤 화면 스크롤 잠금
  useEffect(() => {
    if (!editing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editing]);

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  };

  const unratedCount = records.filter((r) => r.rating == null).length;
  const legacyCount = records.filter((r) => "playedAt" in r).length;

  const list = records
    .filter((r) => matchesQuery(r.name, query))
    .filter((r) => !onlyUnrated || r.rating == null)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const openEdit = (rec) => {
    setEditing(rec);
    setStep("edit");
    setName(rec.name);
    setIsRange(rec.min !== rec.max);
    setMinPlayers(String(rec.min));
    setMaxPlayers(rec.min !== rec.max ? String(rec.max) : "");
    setRating(rec.rating ?? null);
    setError("");
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
  };

  const selectMode = (range) => {
    if (range === isRange) return;
    setIsRange(range);
    setMaxPlayers("");
    setError("");
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    const min = Number(minPlayers);
    const max = isRange ? Number(maxPlayers) : min;
    const inRange = (n) =>
      Number.isInteger(n) && n >= MIN_PLAYERS && n <= MAX_PLAYERS;

    if (!trimmed) return setError("게임 이름을 입력해주세요.");
    if (!inRange(min))
      return setError(`인원수는 ${MIN_PLAYERS}~${MAX_PLAYERS} 사이 숫자로 입력해주세요.`);
    if (isRange && !inRange(max))
      return setError(`최대 인원수를 ${MIN_PLAYERS}~${MAX_PLAYERS} 사이 숫자로 입력해주세요.`);
    if (max < min) return setError("최대 인원이 최소 인원보다 작아요.");

    setSaving(true);
    setError("");
    try {
      await updatePlayed((current) => {
        const idx = current.findIndex((r) => r.id === editing.id);
        if (idx < 0) throw new Error("NOT_FOUND");
        const key = normalizeName(trimmed);
        const dup = current.some(
          (r) => r.id !== editing.id && normalizeName(r.name) === key,
        );
        if (dup) throw new Error("DUPLICATE");
        const next = current.slice();
        // 필요한 필드만 저장 (예전 기록에 남은 playedAt 같은 값은 함께 정리됨)
        next[idx] = { id: editing.id, name: trimmed, min, max, rating };
        return next;
      });
      setEditing(null);
      flash("저장했어요.");
    } catch (e) {
      setError(
        e.message === "DUPLICATE"
          ? "이미 같은 이름의 기록이 있어요."
          : e.message === "NOT_FOUND"
            ? "이미 삭제된 기록이에요."
            : "저장에 실패했어요. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError("");
    try {
      await updatePlayed((current) =>
        current.filter((r) => r.id !== editing.id),
      );
      setEditing(null);
      flash("삭제했어요.");
    } catch {
      setError("삭제에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  // 예전 기록에 남아 있는 playedAt(날짜) 값을 한 번에 제거
  const handleCleanup = async () => {
    try {
      await updatePlayed((current) =>
        current.map((r) => {
          const copy = { ...r };
          delete copy.playedAt;
          return copy;
        }),
      );
      flash("날짜 정보를 정리했어요.");
    } catch {
      flash("정리에 실패했어요. 잠시 후 다시 시도해주세요.");
    }
  };

  const onEnter = (e) => e.key === "Enter" && handleSave();

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">플레이 기록 관리</h2>
      <p className="admin-desc">
        기록을 누르면 이름, 인원수, 별점을 고치거나 삭제할 수 있어요. (총{" "}
        {records.length}개)
      </p>

      <div className="played-admin-tools">
        <div className="game-search">
          <input
            className="game-search-input"
            type="text"
            placeholder="기록 검색"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
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
        <button
          type="button"
          className={`played-admin-filter ${onlyUnrated ? "active" : ""}`}
          onClick={() => setOnlyUnrated((v) => !v)}
        >
          별점 없음 {unratedCount}
        </button>
      </div>

      <div className="played-admin-list">
        {list.length === 0 ? (
          <p className="game-empty">
            {records.length === 0 ? "기록이 없어요" : "일치하는 기록이 없어요"}
          </p>
        ) : (
          list.map((r) => (
            <button
              key={r.id}
              type="button"
              className="game-item played-admin-row"
              onClick={() => openEdit(r)}
            >
              <span className="game-item-name">{r.name}</span>
              <span className="game-item-players">{formatPlayers(r)}</span>
              <span
                className={`game-item-rating ${r.rating == null ? "none" : ""}`}
              >
                {r.rating != null ? `★ ${r.rating.toFixed(1)}` : "–"}
              </span>
            </button>
          ))
        )}
      </div>

      {legacyCount > 0 && (
        <p className="played-admin-legacy">
          예전 기록 {legacyCount}개에 쓰지 않는 날짜 정보가 남아 있어요.{" "}
          <button type="button" onClick={handleCleanup}>
            정리하기
          </button>
        </p>
      )}
      {msg && <p className="admin-msg">{msg}</p>}

      {editing && (
        <>
          <div className="game-overlay level-2" />
          <div
            className="game-modal level-2 small"
            role="dialog"
            aria-modal="true"
            aria-label="플레이 기록 수정"
          >
            {step === "edit" ? (
              <>
                <h2 className="game-modal-title played-edit-title">기록 수정</h2>

                <div className="game-form">
                  <input
                    className="game-input"
                    type="text"
                    placeholder="게임 이름"
                    value={name}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={onEnter}
                  />
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
                      min={MIN_PLAYERS}
                      max={MAX_PLAYERS}
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
                          min={MIN_PLAYERS}
                          max={MAX_PLAYERS}
                          placeholder="최대"
                          value={maxPlayers}
                          onChange={(e) => setMaxPlayers(e.target.value)}
                          onKeyDown={onEnter}
                        />
                      </>
                    )}
                    <span className="game-unit">명</span>
                  </div>

                  <div className="played-edit-rating">
                    <StarRating value={rating ?? 0} onChange={setRating} />
                    <p
                      className={`game-rating-value ${rating ? "" : "empty"}`}
                    >
                      {rating ? rating.toFixed(1) : "별점 없음"}
                    </p>
                    {rating !== null && (
                      <button
                        type="button"
                        className="played-edit-clear"
                        onClick={() => setRating(null)}
                      >
                        별점 지우기
                      </button>
                    )}
                  </div>

                  {error && <p className="game-error">{error}</p>}
                </div>

                <div className="game-actions">
                  <button
                    type="button"
                    className="game-cancel-btn"
                    onClick={closeEdit}
                    disabled={saving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="game-confirm-btn"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    저장
                  </button>
                </div>
                <button
                  type="button"
                  className="played-edit-delete"
                  onClick={() => {
                    setError("");
                    setStep("delete");
                  }}
                  disabled={saving}
                >
                  이 기록 삭제
                </button>
              </>
            ) : (
              <>
                <h2 className="game-modal-title played-edit-title">기록 삭제</h2>
                <p className="game-confirm-text">
                  <strong>{editing.name}</strong> 기록을 삭제할까요?
                </p>
                {error && <p className="game-error">{error}</p>}
                <div className="game-actions">
                  <button
                    type="button"
                    className="game-cancel-btn"
                    onClick={() => setStep("edit")}
                    disabled={saving}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="game-confirm-btn danger"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
