import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, deleteDoc, deleteField, onSnapshot } from "firebase/firestore";

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

      <a className="back-link" href="/">
        ← 멤버 화면으로
      </a>
    </div>
  );
}
