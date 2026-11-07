import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { db } from "./firebase";
import { doc, getDoc, setDoc, deleteField, onSnapshot } from "firebase/firestore";
import emailjs from "@emailjs/browser";
import AdminPage from "./AdminPage";
import GameModal, { GameButton } from "./GameModal";
import SheetNameButton from "./SheetNameButton";
import { DUO_MEMBERS, getDuoCommonDates, useLongPress } from "./duo";

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

// 2인 모드 달력 카드: 길게 누르면 onToggle(날짜)이 호출된다 (canToggle일 때만)
function DuoDateCard({ dateStr, className, canToggle, onToggle, children }) {
  const press = useLongPress(() => onToggle(dateStr));
  return (
    <div
      className={`date-card duo-card ${canToggle ? "duo-pressable" : ""} ${className}`}
      {...(canToggle ? press.handlers : {})}
    >
      {children}
    </div>
  );
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
  const [duoConfirmed, setDuoConfirmed] = useState({}); // 2인 모드에서 확정한 날짜들 { "2026-11-07": true }
  // 2인 모드: duoMode = 화면 내용, duoTheme = 색 반전 (전환 효과가 끝나면 켜진다)
  const [duoMode, setDuoMode] = useState(false);
  const [duoTheme, setDuoTheme] = useState(false);
  const [fx, setFx] = useState(null); // 전환 효과 { x, y, toDuo }

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
        setDuoConfirmed({});
        return;
      }
      const data = snap.data();
      setManualConfirmedDate(data.manualConfirmedDate || null);
      setDuoConfirmed(data.duoConfirmed || {});
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

  // 색 반전은 <html>에 duo 클래스를 붙여서 적용 (페이지를 벗어나면 정리)
  useEffect(() => {
    document.documentElement.classList.toggle("duo", duoTheme);
  }, [duoTheme]);
  useEffect(() => () => document.documentElement.classList.remove("duo"), []);

  // 2인 모드 전환: 실제 화면은 효과가 끝날 때 바뀐다.
  // 효과 동안에는 "바뀐 뒤의 화면"을 한 장 더 그려서 원 안에서만 보이게 한다.
  const applyMode = (toDuo) => {
    setDuoMode(toDuo);
    setDuoTheme(toDuo);
    if (toDuo) {
      setSelectedName("");
      setMyDates([]);
      setSubmitted(false);
    }
  };
  const switchMode = (toDuo, pos) => {
    if (fx) return;
    setSheetOpen(false);
    if (toDuo) navigator.vibrate?.(40);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyMode(toDuo);
      return;
    }
    setFx({
      x: pos?.x || window.innerWidth / 2,
      y: pos?.y || window.innerHeight / 2,
      scrollY: window.scrollY,
      toDuo,
    });
  };
  const finishFx = () => {
    applyMode(fx.toDuo);
    setFx(null);
  };

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

  // 2인(벙개) 모드: 두 사람이 모두 투표한 날은 후보, 직접 길게 눌러 확정한 날은 확정
  const duoCommonDates = getDuoCommonDates(allVotes);
  const duoConfirmedDates = Object.keys(duoConfirmed).filter(
    (d) => duoConfirmed[d] && d.startsWith(`${monthPrefix}-`),
  );
  const hasDuoConfirmed = duoConfirmedDates.length > 0;
  const duoAllDates = [...new Set([...allDates, ...duoConfirmedDates])].sort();

  // 날짜 하나의 확정을 켜고 끈다 (날짜별로 따로 저장해서 서로 덮어쓰지 않는다)
  const toggleDuoConfirm = async (dateStr) => {
    const turnOn = !duoConfirmed[dateStr];
    try {
      await setDoc(
        doc(db, "votes", monthKey),
        { duoConfirmed: { [dateStr]: turnOn ? true : deleteField() } },
        { merge: true },
      );
    } catch (e) {
      console.error("벙개 날짜 저장 실패", e);
    }
  };

  // 모드별 본문 (월 이동 ~ 날짜 카드 ~ 투표 버튼)
  const renderBody = (isDuo) => (
    <>
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
        {isDuo ? (
          <button
            className="name-trigger duo-exit"
            onClick={(e) => switchMode(false, { x: e.clientX, y: e.clientY })}
          >
            <strong>2인 모드</strong>
            <span className="name-trigger-arrow">전체 모드로 ⟲</span>
          </button>
        ) : (
          <button className="name-trigger" onClick={() => setSheetOpen(true)}>
            {selectedName || "이름을 선택하세요"}
            <span className="name-trigger-arrow">▾</span>
          </button>
        )}
      </div>

      {!isDuo && passList.length > 0 && (
        <p className="pass-notice">
          이번 달은 참여가 어려워요😢 : {passList.join(", ")}
        </p>
      )}

      {isDuo && duoCommonDates.length === 0 && !hasDuoConfirmed && (
        <p className="duo-summary">아직 두 사람이 모두 가능한 날이 없어요</p>
      )}

      <div className="dates-grid">
        {isDuo
          ? duoAllDates.map((dateStr) => {
              const { day, dow } = formatDateInfo(dateStr);
              const isCommon = duoCommonDates.includes(dateStr);
              const isConfirmed = !!duoConfirmed[dateStr];
              const isRegular = dateStr === confirmedDate;
              return (
                <DuoDateCard
                  key={dateStr}
                  dateStr={dateStr}
                  className={`${isConfirmed ? "meeting-confirmed" : ""} ${isCommon || isConfirmed ? "" : "duo-off"}`}
                  canToggle={isConfirmed || (isCommon && !isRegular)}
                  onToggle={toggleDuoConfirm}
                >
                  <span className="date-dow">{dow}</span>
                  <span className="date-day">{day}</span>
                  <span className="date-count">
                    {isConfirmed ? (
                      <span className="count-badge">확정</span>
                    ) : isRegular ? (
                      <span className="duo-regular">정규모임</span>
                    ) : isCommon ? (
                      hasDuoConfirmed ? (
                        <span className="count-badge duo-soft">예비</span>
                      ) : (
                        <span className="count-badge">후보</span>
                      )
                    ) : (
                      <span className="count-empty">-</span>
                    )}
                  </span>
                  <span className="voters">
                    {isCommon
                      ? DUO_MEMBERS.slice()
                          .sort((a, b) => a.localeCompare(b, "ko"))
                          .join(", ")
                      : ""}
                  </span>
                </DuoDateCard>
              );
            })
          : allDates.map((dateStr) => {
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

      {!isDuo && selectedName && (
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
    </>
  );

  return (
    <div className="app">
      {renderBody(duoMode)}

      <div
        className={`sheet-overlay ${sheetOpen ? "open" : ""}`}
        onClick={() => setSheetOpen(false)}
      />

      <GameModal open={gameOpen} onClose={() => setGameOpen(false)} duo={duoMode} />

      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <p className="sheet-title">사칭금지</p>
        <div className="sheet-grid">
          {allMembers.map((name) => (
            <SheetNameButton
              key={name}
              name={name}
              active={selectedName === name}
              onSelect={handleSelectName}
              onDuo={(pos) => switchMode(true, pos)}
            />
          ))}
        </div>
      </div>

      {fx &&
        createPortal(
          <>
            {/* 바뀐 뒤의 화면을 원 안에서만 보여준다 (자체 색 반전으로 최종 모습과 동일) */}
            <div
              className="duo-layer"
              aria-hidden="true"
              inert
              style={{ "--fx-x": `${fx.x}px`, "--fx-y": `${fx.y}px` }}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) finishFx();
              }}
            >
              <div
                className="app"
                style={{ transform: `translateY(${-fx.scrollY}px)` }}
              >
                {renderBody(fx.toDuo)}
              </div>
            </div>
            <div className="duo-ring" style={{ left: fx.x, top: fx.y }} />
          </>,
          document.body,
        )}
    </div>
  );
}

export default function App() {
  const isAdmin = window.location.pathname === "/admin";
  return isAdmin ? <AdminPage /> : <MemberPage />;
}
