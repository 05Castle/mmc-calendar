import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, deleteDoc, deleteField, onSnapshot, runTransaction } from "firebase/firestore";

// ===== 임시 기능: 플레이 완료 기록 일괄 등록 =====
// 과거에 플레이한 게임을 config/played 에 한꺼번에 넣기 위한 도구예요.
// 등록이 끝나면 이 블록, 아래 bulk 관련 state/함수, "플레이 기록 일괄 등록" 섹션을 삭제하세요.
const normalizeName = (str) =>
  str.toLowerCase().replace(/[\s\-_:'’".,!?·&]/g, "");

const makeRecordId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 한 줄에 게임 하나: "제목, 인원수, 별점"
//   인원수: 4 / 2-5 (범위는 띄어쓰기 없이 min-max)
//   별점: 0.5 단위 (0.5~5), 생략 가능
// 제목에 쉼표가 있어도 오른쪽부터 읽어서 처리한다.
const PLAYERS_RE = /^(\d+)(?:[-~](\d+))?명?$/;
const RATING_RE = /^\d+(?:\.\d+)?$/;

function parseBulk(text, existingRecords) {
  const existing = new Map(existingRecords.map((r) => [normalizeName(r.name), r]));
  const seen = new Set();
  const valid = []; // 새로 등록할 기록
  const fill = new Map(); // 이미 있는데 별점이 비어 있어서 채워줄 기록: key → rating
  const errors = [];
  let skipped = 0;

  text.split("\n").forEach((raw, i) => {
    const no = i + 1;
    const line = raw.trim();
    if (!line) return;
    const fail = (reason) => errors.push({ no, line, reason });

    const parts = line.split(",").map((x) => x.trim());
    if (parts.length >= 3 && parts[parts.length - 1] === "") parts.pop(); // 끝의 빈 별점 칸

    // 오른쪽부터: [제목…, 인원수, (별점)]
    let rating = null;
    let playersText;
    let nameParts;
    if (
      parts.length >= 3 &&
      RATING_RE.test(parts[parts.length - 1]) &&
      PLAYERS_RE.test(parts[parts.length - 2])
    ) {
      rating = Number(parts[parts.length - 1]);
      playersText = parts[parts.length - 2];
      nameParts = parts.slice(0, -2);
    } else if (parts.length >= 2) {
      playersText = parts[parts.length - 1];
      nameParts = parts.slice(0, -1);
    } else {
      return fail('"제목, 인원수, 별점" 형태로 적어주세요');
    }

    const name = nameParts.join(", ").trim();
    const m = playersText.match(PLAYERS_RE);
    if (!name) return fail("제목이 비어 있어요");
    if (!m) return fail("인원수는 4 또는 2-5 형태로 적어주세요");
    if (name.length > 40) return fail("제목이 너무 길어요 (40자 이하)");

    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    if (min < 1 || min > 9 || max < 1 || max > 9)
      return fail("인원수는 1~9 사이여야 해요");
    if (max < min) return fail("최대 인원이 최소보다 작아요");
    if (rating !== null && (rating < 0.5 || rating > 5 || (rating * 2) % 1 !== 0))
      return fail("별점은 0.5 단위로 0.5~5 사이여야 해요");

    const key = normalizeName(name);
    if (seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);

    const prev = existing.get(key);
    if (prev) {
      // 이미 등록된 게임: 기록에 별점이 없고 이번에 별점이 있으면 채워 넣는다
      if (prev.rating == null && rating !== null) fill.set(key, rating);
      else skipped++;
      return;
    }
    valid.push({ name, min, max, rating });
  });

  return { valid, fill, errors, skipped };
}

function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default function AdminPage() {
  const now = new Date();
  const [guests, setGuests] = useState([]);
  const [newGuest, setNewGuest] = useState("");
  const [extraDates, setExtraDates] = useState([]); // 커스텀 날짜 목록
  const [newDate, setNewDate] = useState("");
  const [resetYear, setResetYear] = useState(now.getFullYear());
  const [resetMonth, setResetMonth] = useState(now.getMonth());
  const [msg, setMsg] = useState("");
  const [manualYear, setManualYear] = useState(now.getFullYear());
  const [manualMonth, setManualMonth] = useState(now.getMonth());
  const [manualDate, setManualDate] = useState("");
  const [savedManualDate, setSavedManualDate] = useState(null);
  const [bulkText, setBulkText] = useState(""); // 임시: 일괄 등록
  const [playedRecords, setPlayedRecords] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  const manualMonthKey = getMonthKey(manualYear, manualMonth);
  const manualMonthStart = `${manualMonthKey}-01`;
  const manualMonthEnd = `${manualMonthKey}-${String(new Date(manualYear, manualMonth + 1, 0).getDate()).padStart(2, "0")}`;

  // 게스트 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "members"), (snap) => {
      if (snap.exists()) setGuests(snap.data().guests || []);
      else setGuests([]);
    });
    return () => unsub();
  }, []);

  // 선택한 달의 수동 확정 날짜 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "votes", manualMonthKey), (snap) => {
      const date = snap.exists() ? snap.data().manualConfirmedDate || null : null;
      setSavedManualDate(date);
      setManualDate(date || "");
    });
    return () => unsub();
  }, [manualMonthKey]);

  // 커스텀 날짜 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "extraDates"), (snap) => {
      if (snap.exists()) setExtraDates(snap.data().dates || []);
      else setExtraDates([]);
    });
    return () => unsub();
  }, []);

  // 임시: 플레이 완료 기록 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "played"), (snap) => {
      setPlayedRecords(snap.exists() ? snap.data().records || [] : []);
    });
    return () => unsub();
  }, []);

  const bulk = parseBulk(bulkText, playedRecords);

  const handleBulkSave = async () => {
    if ((bulk.valid.length === 0 && bulk.fill.size === 0) || bulkSaving) return;
    setBulkSaving(true);
    try {
      let added = 0;
      let filled = 0;
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "config", "played");
        const snap = await tx.get(ref);
        const records = snap.exists() ? snap.data().records || [] : [];
        const byKey = new Map(records.map((r) => [normalizeName(r.name), r]));

        // 별점 보충 (최신 기록 기준으로 다시 확인)
        filled = 0;
        const updated = records.map((r) => {
          const key = normalizeName(r.name);
          if (bulk.fill.has(key) && r.rating == null) {
            filled++;
            return { ...r, rating: bulk.fill.get(key) };
          }
          return r;
        });

        // 새 기록 (그 사이 다른 곳에서 생긴 이름은 제외)
        const fresh = bulk.valid.filter((g) => !byKey.has(normalizeName(g.name)));
        added = fresh.length;
        tx.set(ref, {
          records: [
            ...updated,
            ...fresh.map((g) => ({
              id: makeRecordId(),
              name: g.name,
              min: g.min,
              max: g.max,
              rating: g.rating, // 숫자 또는 null
              playedAt: null,
            })),
          ],
        });
      });
      setBulkText("");
      setBulkMsg(
        `${added}개를 등록했어요.` + (filled ? ` (별점 보충 ${filled}개)` : ""),
      );
    } catch {
      setBulkMsg("등록에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBulkSaving(false);
      setTimeout(() => setBulkMsg(""), 4000);
    }
  };

  const saveGuests = async (updated) => {
    await setDoc(doc(db, "config", "members"), { guests: updated });
  };

  const saveExtraDates = async (updated) => {
    await setDoc(doc(db, "config", "extraDates"), { dates: updated });
  };

  // 게스트
  const addGuest = async () => {
    const name = newGuest.trim();
    if (!name || guests.includes(name)) return;
    await saveGuests([...guests, name]);
    setNewGuest("");
  };

  const removeGuest = async (name) => {
    await saveGuests(guests.filter((g) => g !== name));
  };

  // 커스텀 날짜
  const addExtraDate = async () => {
    if (!newDate || extraDates.includes(newDate)) return;
    await saveExtraDates([...extraDates, newDate].sort());
    setNewDate("");
  };

  const removeExtraDate = async (date) => {
    await saveExtraDates(extraDates.filter((d) => d !== date));
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  };

  // 수동 확정 날짜 설정 및 해제
  const handleManualDateSave = async () => {
    if (!manualDate || !manualDate.startsWith(`${manualMonthKey}-`)) {
      setMsg("선택한 달에 해당하는 날짜를 골라주세요.");
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    await setDoc(
      doc(db, "votes", manualMonthKey),
      { manualConfirmedDate: manualDate },
      { merge: true },
    );
    setMsg(`${manualYear}년 ${manualMonth + 1}월 확정 날짜를 ${formatDate(manualDate)}로 변경했어요.`);
    setTimeout(() => setMsg(""), 3000);
  };

  const handleManualDateClear = async () => {
    const ref = doc(db, "votes", manualMonthKey);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(ref, { manualConfirmedDate: deleteField() }, { merge: true });
    }
    setManualDate("");
    setMsg(`${manualYear}년 ${manualMonth + 1}월 자동 확정 규칙으로 돌아갑니다.`);
    setTimeout(() => setMsg(""), 3000);
  };

  const changeManualMonth = (dir) => {
    let m = manualMonth + dir;
    let y = manualYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setManualMonth(m);
    setManualYear(y);
  };

  // 초기화
  const handleReset = async () => {
    const monthKey = getMonthKey(resetYear, resetMonth);
    const confirmed = window.confirm(
      `${resetYear}년 ${resetMonth + 1}월 투표 데이터를 삭제할까요?\n게스트와 커스텀 날짜도 함께 초기화됩니다.`,
    );
    if (!confirmed) return;
    await deleteDoc(doc(db, "votes", monthKey));
    await saveGuests([]);
    await saveExtraDates([]);
    setMsg(`${resetYear}년 ${resetMonth + 1}월 초기화 완료`);
    setTimeout(() => setMsg(""), 3000);
  };

  const changeResetMonth = (dir) => {
    let m = resetMonth + dir;
    let y = resetYear;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (m < 0) {
      m = 11;
      y--;
    }
    setResetMonth(m);
    setResetYear(y);
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">관리자</h1>
      </header>

      {/* 게스트 관리 */}
      <section className="admin-section">
        <h2 className="admin-section-title">게스트 추가</h2>
        <div className="guest-input-row">
          <input
            className="guest-input"
            type="text"
            placeholder="게스트 이름"
            value={newGuest}
            onChange={(e) => setNewGuest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGuest()}
            maxLength={10}
          />
          <button className="guest-add-btn" onClick={addGuest}>
            추가
          </button>
        </div>
        {guests.length > 0 ? (
          <div className="guest-list">
            {guests.map((g) => (
              <div key={g} className="guest-item">
                <span className="guest-name">{g}</span>
                <button
                  className="guest-remove-btn"
                  onClick={() => removeGuest(g)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-empty">추가된 게스트 없음</p>
        )}
      </section>

      {/* 커스텀 날짜 추가 */}
      <section className="admin-section">
        <h2 className="admin-section-title">날짜 추가</h2>
        <p className="admin-desc">
          공휴일·연휴 등 주말 외 날짜를 투표 목록에 추가해요.
        </p>
        <div className="guest-input-row">
          <input
            className="guest-input"
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <button className="guest-add-btn" onClick={addExtraDate}>
            추가
          </button>
        </div>
        {extraDates.length > 0 ? (
          <div className="guest-list">
            {extraDates.map((d) => (
              <div key={d} className="guest-item">
                <span className="guest-name">{formatDate(d)}</span>
                <button
                  className="guest-remove-btn"
                  onClick={() => removeExtraDate(d)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-empty">추가된 날짜 없음</p>
        )}
      </section>

      {/* 확정 날짜 수동 지정 */}
      <section className="admin-section">
        <h2 className="admin-section-title">확정 날짜 변경</h2>
        <p className="admin-desc">
          직접 날짜를 지정하면 자동 확정 규칙보다 우선해요. 수동 지정을 해제하면 다시 투표 결과로 자동 결정돼요.
        </p>
        <div className="month-nav" style={{ marginBottom: 16 }}>
          <button className="nav-btn" onClick={() => changeManualMonth(-1)}>
            ‹
          </button>
          <span className="month-label">
            {manualYear}년 {manualMonth + 1}월
          </span>
          <button className="nav-btn" onClick={() => changeManualMonth(1)}>
            ›
          </button>
        </div>
        <div className="guest-input-row">
          <input
            className="guest-input"
            type="date"
            min={manualMonthStart}
            max={manualMonthEnd}
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
          />
          <button className="guest-add-btn" onClick={handleManualDateSave}>
            지정
          </button>
        </div>
        {savedManualDate ? (
          <>
            <p className="admin-desc" style={{ marginTop: 10, marginBottom: 10 }}>
              현재 수동 확정: {formatDate(savedManualDate)}
            </p>
            <button className="reset-btn" onClick={handleManualDateClear}>
              수동 지정 해제 (자동 확정으로 복귀)
            </button>
          </>
        ) : (
          <p className="admin-empty">수동 지정 없음 · 자동 확정 규칙 적용 중</p>
        )}
        {msg && <p className="admin-msg">{msg}</p>}
      </section>

      {/* 투표 초기화 */}
      <section className="admin-section">
        <h2 className="admin-section-title">투표 초기화</h2>
        <p className="admin-desc">
          모임이 끝난 후 해당 월 투표 데이터, 게스트, 커스텀 날짜를 삭제해요.
        </p>
        <div className="month-nav" style={{ marginBottom: 16 }}>
          <button className="nav-btn" onClick={() => changeResetMonth(-1)}>
            ‹
          </button>
          <span className="month-label">
            {resetYear}년 {resetMonth + 1}월
          </span>
          <button className="nav-btn" onClick={() => changeResetMonth(1)}>
            ›
          </button>
        </div>
        <button className="reset-btn" onClick={handleReset}>
          {resetYear}년 {resetMonth + 1}월 초기화
        </button>
        {msg && <p className="admin-msg">{msg}</p>}
      </section>

      {/* 임시: 플레이 기록 일괄 등록 (등록이 끝나면 삭제) */}
      <section className="admin-section">
        <h2 className="admin-section-title">플레이 기록 일괄 등록</h2>
        <p className="admin-desc">
          한 줄에 게임 하나씩 "제목, 인원수, 별점" 형태로 붙여넣어요. 인원수
          범위는 2-5처럼 띄어쓰기 없이 적고, 별점은 0.5 단위(0.5~5)이며
          생략해도 돼요. 이미 등록됐는데 별점이 비어 있는 게임은 별점만
          채워져요. (현재 기록 {playedRecords.length}개)
        </p>
        <textarea
          className="bulk-textarea"
          rows={8}
          placeholder={"아이언 하우스, 6, 4.5\nMurder Mystery, 5-7\n오리엔트 특급, 4, 3"}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
        />
        {bulkText.trim() && (
          <div className="bulk-result">
            <p className="bulk-summary">
              새로 등록 <strong>{bulk.valid.length}</strong>개
              {bulk.fill.size > 0 && ` · 별점 보충 ${bulk.fill.size}개`}
              {bulk.skipped > 0 && ` · 이미 있어서 제외 ${bulk.skipped}개`}
              {bulk.errors.length > 0 && ` · 오류 ${bulk.errors.length}줄`}
            </p>
            {bulk.errors.map((e) => (
              <p key={e.no} className="bulk-error">
                {e.no}번째 줄: {e.line} → {e.reason}
              </p>
            ))}
            {bulk.valid.length > 0 && (
              <div className="bulk-preview">
                {bulk.valid.map((g) => (
                  <div key={g.name} className="bulk-preview-row">
                    <span>{g.name}</span>
                    <span>
                      {g.min === g.max ? `${g.min}명` : `${g.min}~${g.max}명`}
                      {g.rating !== null && ` · ★ ${g.rating.toFixed(1)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          className="guest-add-btn bulk-save-btn"
          onClick={handleBulkSave}
          disabled={(bulk.valid.length === 0 && bulk.fill.size === 0) || bulkSaving}
        >
          {bulk.valid.length}개 등록
          {bulk.fill.size > 0 && ` + 별점 ${bulk.fill.size}개 보충`}
        </button>
        {bulkMsg && <p className="admin-msg">{bulkMsg}</p>}
      </section>

      <a className="back-link" href="/">
        ← 멤버 화면으로
      </a>
    </div>
  );
}
