import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import emailjs from "@emailjs/browser";
import AdminPage from "./AdminPage";
import GameModal, { GameButton } from "./GameModal";

const BASE_MEMBERS = ["다혜", "세원", "오성", "태현", "해리"];

const EMAILJS_SERVICE_ID = "service_ondt0zf";
const EMAILJS_TEMPLATE_COMPLETE = "template_h7w7zwc";
const EMAILJS_TEMPLATE_MODIFY = "template_61d4fvq";
const EMAILJS_PUBLIC_KEY = "R3ElbDw-CXqX1Ib8w";

function getWeekends(year, month) {
  const days = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      days.push(dateStr);
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatDateInfo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return { day: d.getDate(), dow: days[d.getDay()] };
}

function MemberPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedName, setSelectedName] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [myDates, setMyDates] = useState([]);
  const [allVotes, setAllVotes] = useState({});
  const [manualConfirmedDate, setManualConfirmedDate] = useState(null);
  const [passList, setPassList] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [guests, setGuests] = useState([]);
  const [extraDates, setExtraDates] = useState([]);

  const monthKey = getMonthKey(year, month);
  const allMembers = [...BASE_MEMBERS, ...guests].sort((a, b) =>
    a.localeCompare(b, "ko"),
  );

  const weekends = getWeekends(year, month);
  const monthPrefix = getMonthKey(year, month);
  const filteredExtras = extraDates.filter((d) => d.startsWith(monthPrefix));
  const manualDateInMonth = manualConfirmedDate?.startsWith(`${monthPrefix}-`)
    ? [manualConfirmedDate]
    : [];
  const allDates = [
    ...new Set([...weekends, ...filteredExtras, ...manualDateInMonth]),
  ].sort();

  // 게스트 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "members"), (snap) => {
      if (snap.exists()) setGuests(snap.data().guests || []);
      else setGuests([]);
    });
    return () => unsub();
  }, []);

  // 커스텀 날짜 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "extraDates"), (snap) => {
      if (snap.exists()) setExtraDates(snap.data().dates || []);
      else setExtraDates([]);
    });
    return () => unsub();
  }, []);

  // 실시간 투표 현황 + 불참 목록 구독
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "votes", monthKey), (snap) => {
      if (!snap.exists()) {
        setAllVotes({});
        setPassList([]);
        setManualConfirmedDate(null);
        return;
      }
      const data = snap.data();
      setManualConfirmedDate(data.manualConfirmedDate || null);
      const merged = {};
      const passes = [];

      Object.entries(data).forEach(([member, value]) => {
        if (member === "emailSent") return;
        if (value === "pass") {
          passes.push(member);
        } else if (Array.isArray(value)) {
          value.forEach((d) => {
            if (!merged[d]) merged[d] = [];
            merged[d].push(member);
          });
        }
      });

      setAllVotes(merged);
      setPassList(passes.slice().sort((a, b) => a.localeCompare(b, "ko")));
    });
    return () => unsub();
  }, [monthKey]);

  // 이름/달 바뀌면 기존 응답 불러오기
  useEffect(() => {
    if (!selectedName) return;
    getDoc(doc(db, "votes", monthKey)).then((snap) => {
      if (snap.exists() && snap.data()[selectedName]) {
        const val = snap.data()[selectedName];
        if (val === "pass") setMyDates([]);
        else setMyDates(val);
      } else {
        setMyDates([]);
      }
    });
  }, [selectedName, monthKey]);

  const handleSelectName = (name) => {
    setSelectedName(name);
    setSubmitted(false);
    setMyDates([]);
    setSheetOpen(false);
  };

  const toggleDate = (dateStr) => {
    setSubmitted(false);
    setMyDates((prev) =>
      prev.includes(dateStr)
        ? prev.filter((d) => d !== dateStr)
        : [...prev, dateStr],
    );
  };

  const sendEmailIfNeeded = async (updatedData) => {
    const requiredMembers = [...BASE_MEMBERS, ...guests];
    const votedMembers = Object.keys(updatedData).filter(
      (k) => k !== "emailSent",
    );
    const allVoted = requiredMembers.every((m) => votedMembers.includes(m));
    const monthLabel = `${year}년 ${month + 1}월`;

    if (allVoted) {
      if (!updatedData.emailSent) {
        await setDoc(doc(db, "votes", monthKey), {
          ...updatedData,
          emailSent: true,
        });
        emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_COMPLETE,
          { month: monthLabel },
          EMAILJS_PUBLIC_KEY,
        );
      } else {
        emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_MODIFY,
          { month: monthLabel },
          EMAILJS_PUBLIC_KEY,
        );
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedName) return;
    const ref = doc(db, "votes", monthKey);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const updated = { ...existing, [selectedName]: myDates };
    await setDoc(ref, updated);
    setSubmitted(true);
    await sendEmailIfNeeded(updated);
  };

  const handlePass = async () => {
    if (!selectedName) return;
    const ref = doc(db, "votes", monthKey);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    const updated = { ...existing, [selectedName]: "pass" };
    await setDoc(ref, updated);
    setMyDates([]);
    setSubmitted(true);
    await sendEmailIfNeeded(updated);
  };

  const goNextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
    setMyDates([]);
    setSubmitted(false);
  };

  const goPrevMonth = () => {
    if (year === now.getFullYear() && month === now.getMonth()) return;
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
    setMyDates([]);
    setSubmitted(false);
  };

  const isPrevDisabled = year === now.getFullYear() && month === now.getMonth();
  const getMaxCount = () =>
    Math.max(1, ...Object.values(allVotes).map((v) => v.length));

  // 모임 확정일: 3명 이상 투표한 날짜 중 최다 득표, 동률이면 가장 빠른 날짜.
  // 후보가 없으면 확정 날짜를 표시하지 않는다.
  const automaticConfirmedDate =
    Object.entries(allVotes)
      .filter(([, voters]) => voters.length >= 3)
      .sort(
        ([dateA, votersA], [dateB, votersB]) =>
          votersB.length - votersA.length || dateA.localeCompare(dateB),
      )[0]?.[0] || null;
  const confirmedDate = manualConfirmedDate || automaticConfirmedDate;

  return (
    <div className="app">
      <div className="month-nav">
        <button
          className={`nav-btn ${isPrevDisabled ? "disabled" : ""}`}
          onClick={goPrevMonth}
          disabled={isPrevDisabled}
        >
          ‹
        </button>
        <span className="month-label">
          {year}년 {month + 1}월
        </span>
        <button className="nav-btn" onClick={goNextMonth}>
          ›
        </button>
      </div>

      <div className="name-section">
        <GameButton onClick={() => setGameOpen(true)} />
        <button className="name-trigger" onClick={() => setSheetOpen(true)}>
          {selectedName || "이름을 선택하세요"}
          <span className="name-trigger-arrow">▾</span>
        </button>
      </div>

      {passList.length > 0 && (
        <p className="pass-notice">
          이번 달은 참여가 어려워요😢 : {passList.join(", ")}
        </p>
      )}

      <div className="dates-grid">
        {allDates.map((dateStr) => {
          const { day, dow } = formatDateInfo(dateStr);
          const count = allVotes[dateStr]?.length || 0;
          const voters = (allVotes[dateStr] || [])
            .slice()
            .sort((a, b) => a.localeCompare(b, "ko"));
          const isSelected = myDates.includes(dateStr);
          const intensity = count > 0 ? count / getMaxCount() : 0;
          const isExtra = filteredExtras.includes(dateStr);
          const isConfirmedDate = dateStr === confirmedDate;

          return (
            <button
              key={dateStr}
              className={`date-card ${isSelected ? "selected" : ""} ${!selectedName ? "no-name" : ""} ${isExtra ? "extra" : ""} ${isConfirmedDate ? "meeting-confirmed" : ""}`}
              onClick={() => selectedName && toggleDate(dateStr)}
            >
              <span className="date-dow">{dow}</span>
              <span className="date-day">{day}</span>
              <span className="date-count">
                {count > 0 ? (
                  <span
                    className="count-badge"
                    style={{ opacity: 0.3 + intensity * 0.7 }}
                  >
                    {count}명
                  </span>
                ) : (
                  <span className="count-empty">-</span>
                )}
              </span>
              <span className="voters">{voters.join(", ")}</span>
            </button>
          );
        })}
      </div>

      {selectedName && (
        <div className="submit-wrap">
          <div className="submit-row">
            <button className="pass-btn" onClick={handlePass}>
              이번달 패스
            </button>
            <button
              className={`submit-btn ${submitted ? "done" : ""}`}
              onClick={handleSubmit}
            >
              {submitted ? "✓ 투표 완료!" : "참가 가능 날짜 투표"}
            </button>
          </div>
          {submitted && (
            <p className="submit-note">다시 선택하고 투표하면 수정됩니다😃</p>
          )}
        </div>
      )}

      <div
        className={`sheet-overlay ${sheetOpen ? "open" : ""}`}
        onClick={() => setSheetOpen(false)}
      />

      <GameModal open={gameOpen} onClose={() => setGameOpen(false)} />

      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <p className="sheet-title">사칭금지</p>
        <div className="sheet-grid">
          {allMembers.map((name) => (
            <button
              key={name}
              className={`sheet-name-btn ${selectedName === name ? "active" : ""}`}
              onClick={() => handleSelectName(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const isAdmin = window.location.pathname === "/admin";
  return isAdmin ? <AdminPage /> : <MemberPage />;
}
