"use client";

import { useEffect, useRef, useState } from "react";

type GradeResult = {
  scores: {
    history: number;
    physical_exam: number;
    education: number;
    etiquette: number;
    relationship: number;
    total: number;
  };
  feedback: {
    history: string;
    physical_exam: string;
    education: string;
    etiquette: string;
    relationship: string;
    overall: string;
  };
  mergedText: string;
};

export default function Home() {
  const [micStatus, setMicStatus] = useState("대기 중");
  const [recordStatus, setRecordStatus] = useState("정지");
  const [transcript, setTranscript] = useState("");
  const [speakerText, setSpeakerText] = useState("");
  const [speakerError, setSpeakerError] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [gradeError, setGradeError] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSeparating, setIsSeparating] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(12 * 60);
  const [logText, setLogText] = useState("로그가 여기에 표시됩니다.");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const currentChunkPartsRef = useRef<Blob[]>([]);
  const segmentBlobsRef = useRef<Blob[]>([]);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const segmentTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const isStoppingAllRef = useRef(false);

  const SEGMENT_MS = 60_000;

  function log(message: string) {
    const now = new Date().toLocaleTimeString("ko-KR");
    setLogText((prev) =>
      prev === "로그가 여기에 표시됩니다."
        ? `[${now}] ${message}`
        : `${prev}\n[${now}] ${message}`
    );
  }

  function formatTime(totalSeconds: number) {
    const min = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const sec = String(totalSeconds % 60).padStart(2, "0");
    return `${min}:${sec}`;
  }

  function clearCountdownTimer() {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }

  function clearSegmentTimer() {
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  }

  function clearAllTimers() {
    clearCountdownTimer();
    clearSegmentTimer();
  }

  async function getMicrophone() {
    if (streamRef.current) return streamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 마이크 기능을 지원하지 않습니다.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    streamRef.current = stream;
    setMicStatus("연결됨");
    log("마이크 권한 허용 완료");
    return stream;
  }

  function pickMimeType() {
    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];

    for (const type of preferredTypes) {
      try {
        if (
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(type)
        ) {
          return type;
        }
      } catch {
        // ignore
      }
    }

    return "";
  }

  function startCountdown() {
    clearCountdownTimer();

    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearAllTimers();
          log("12분 종료 → 자동 정지");
          stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function startSegmentRecorder(stream: MediaStream) {
    const mimeType = pickMimeType();
    currentChunkPartsRef.current = [];

    const recorder = mimeType
      ? new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 24000,
        })
      : new MediaRecorder(stream, {
          audioBitsPerSecond: 24000,
        });

    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        currentChunkPartsRef.current.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error("Recorder error:", event);
      setRecordStatus("오류");
      log("녹음 중 오류 발생");
    };

    recorder.onstop = async () => {
      try {
        const chunkBlob = new Blob(currentChunkPartsRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        if (chunkBlob.size > 0) {
          segmentBlobsRef.current.push(chunkBlob);
          log(
            `세그먼트 저장 완료 (${segmentBlobsRef.current.length}개, ${Math.round(
              chunkBlob.size / 1024
            )} KB)`
          );
        }

        if (!isStoppingAllRef.current && streamRef.current) {
          await startSegmentRecorder(streamRef.current);
        } else {
          const fullBlob = new Blob(segmentBlobsRef.current, {
            type: recorder.mimeType || "audio/webm",
          });

          if (fullBlob.size > 0) {
            const url = URL.createObjectURL(fullBlob);
            audioUrlRef.current = url;

            if (playerRef.current) {
              playerRef.current.src = url;
            }
          }

          setRecordStatus("정지");
          log(
            `녹음 종료. 세그먼트 수: ${segmentBlobsRef.current.length}개`
          );

          await uploadForAnalysis();
        }
      } catch (error) {
        console.error(error);
        setTranscript("녹음 종료 후 처리 중 오류가 발생했습니다.");
        setSpeakerText("");
        setSpeakerError("녹음 종료 후 처리 중 오류가 발생했습니다.");
        setGradeResult(null);
        setGradeError("");
        setIsTranscribing(false);
        setIsSeparating(false);
        setIsGrading(false);
      }
    };

    recorder.start();
    setRecordStatus("녹음 중");

    clearSegmentTimer();
    segmentTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, SEGMENT_MS);
  }

  async function startRecording() {
    try {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        log("이미 녹음 중입니다.");
        return;
      }

      setTranscript("");
      setSpeakerText("");
      setSpeakerError("");
      setGradeResult(null);
      setGradeError("");
      setIsTranscribing(false);
      setIsSeparating(false);
      setIsGrading(false);
      setRemainingSeconds(12 * 60);

      segmentBlobsRef.current = [];
      currentChunkPartsRef.current = [];
      isStoppingAllRef.current = false;

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }

      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.removeAttribute("src");
        playerRef.current.load();
      }

      const stream = await getMicrophone();
      await startSegmentRecorder(stream);

      log("녹음 시작 (1분마다 완성 파일로 분할 저장)");
      startCountdown();
    } catch (error) {
      console.error(error);
      setMicStatus("실패");
      setRecordStatus("정지");
      alert("마이크 권한 또는 브라우저 설정을 확인해줘.");
    }
  }

  function stopRecording() {
    clearAllTimers();
    isStoppingAllRef.current = true;

    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }

  async function resetAll() {
    clearAllTimers();
    isStoppingAllRef.current = true;

    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }

    recorderRef.current = null;
    currentChunkPartsRef.current = [];
    segmentBlobsRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.removeAttribute("src");
      playerRef.current.load();
    }

    setMicStatus("대기 중");
    setRecordStatus("정지");
    setTranscript("");
    setSpeakerText("");
    setSpeakerError("");
    setGradeResult(null);
    setGradeError("");
    setIsTranscribing(false);
    setIsSeparating(false);
    setIsGrading(false);
    setRemainingSeconds(12 * 60);
    setLogText("로그가 여기에 표시됩니다.");
  }

  async function transcribeSingleSegment(segment: Blob, index: number, total: number) {
    const formData = new FormData();
    const ext = segment.type.includes("mp4") ? "mp4" : "webm";
    formData.append("file", segment, `segment-${index + 1}.${ext}`);

    log(`전사 세그먼트 ${index + 1}/${total} 업로드 시작`);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || `전사 실패 (세그먼트 ${index + 1}/${total})`);
    }

    log(`전사 세그먼트 ${index + 1}/${total} 완료`);

    return typeof data?.text === "string" ? data.text.trim() : "";
  }

  async function transcribeAllSegments() {
    const segments = segmentBlobsRef.current.filter((blob) => blob.size > 0);

    if (segments.length === 0) {
      throw new Error("전사할 세그먼트가 없습니다.");
    }

    const texts: string[] = [];

    for (let i = 0; i < segments.length; i += 1) {
      setTranscript(`전사 중... (${i + 1}/${segments.length})`);
      const text = await transcribeSingleSegment(segments[i], i, segments.length);
      if (text) texts.push(text);
    }

    return texts.join("\n").trim();
  }

  async function uploadForAnalysis() {
    try {
      setIsTranscribing(true);
      setIsSeparating(false);
      setIsGrading(false);
      setTranscript("전사 중...");
      setSpeakerText("");
      setSpeakerError("");
      setGradeResult(null);
      setGradeError("");

      const transcriptText = await transcribeAllSegments();
      const finalTranscript = transcriptText || "(텍스트 없음)";

      setTranscript(finalTranscript);
      log("전체 전사 완료");
      setIsTranscribing(false);

      let mergedText = "";

      try {
        setIsSeparating(true);
        log("화자 분리 시작");

        const speakerRes = await fetch("/api/speaker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: finalTranscript }),
        });

        const speakerData = await speakerRes.json();

        if (!speakerRes.ok) {
          throw new Error(speakerData?.error || "화자 분리 실패");
        }

        mergedText =
          typeof speakerData?.mergedText === "string" && speakerData.mergedText.trim()
            ? speakerData.mergedText
            : "(화자 분리 결과 없음)";

        setSpeakerText(mergedText);
        setSpeakerError("");
        log("화자 분리 완료");
      } catch (error) {
        console.error("speaker error:", error);
        setSpeakerText("");
        setSpeakerError(
          error instanceof Error
            ? `화자 분리 실패: ${error.message}`
            : "화자 분리 중 오류가 발생했습니다."
        );
        log("화자 분리 실패");
        return;
      } finally {
        setIsSeparating(false);
      }

      try {
        setIsGrading(true);
        log("AI 채점 시작");

        const gradeRes = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mergedText }),
        });

        const gradeData = await gradeRes.json();

        if (!gradeRes.ok) {
          throw new Error(gradeData?.error || "채점 실패");
        }

        setGradeResult(gradeData);
        setGradeError("");
        log("AI 채점 완료");
      } catch (error) {
        console.error("grade error:", error);
        setGradeResult(null);
        setGradeError(
          error instanceof Error
            ? `AI 채점 실패: ${error.message}`
            : "AI 채점 중 오류가 발생했습니다."
        );
        log("AI 채점 실패");
      } finally {
        setIsGrading(false);
      }
    } catch (error) {
      console.error("transcribe error:", error);
      setTranscript(
        error instanceof Error
          ? `전사 실패: ${error.message}`
          : "전사 중 오류가 발생했습니다."
      );
      setSpeakerText("");
      setSpeakerError("");
      setGradeResult(null);
      setGradeError("");
      setIsTranscribing(false);
      setIsSeparating(false);
      setIsGrading(false);
      log("전사 실패");
    }
  }

  useEffect(() => {
    return () => {
      clearAllTimers();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f7fb",
        padding: "24px 16px 48px",
        color: "#111827",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "6px 10px",
            borderRadius: 999,
            background: "#dbeafe",
            color: "#1d4ed8",
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          6차 테스트 버전
        </div>

        <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
          CPX 음성 전사 + 화자 분리 + AI 채점
        </h1>
        <p style={{ margin: "0 0 20px", color: "#4b5563", lineHeight: 1.6 }}>
          ON을 누르면 녹음을 시작하고, STOP 후 1분 단위 완성 파일로 전사한 뒤 화자 분리와 AI 채점을 진행합니다.
        </p>

        <div
          style={{
            padding: 16,
            borderRadius: 14,
            background: "#f3f4f6",
            marginBottom: 16,
            lineHeight: 1.8,
          }}
        >
          <div>마이크 상태: {micStatus}</div>
          <div>녹음 상태: {recordStatus}</div>
          <div>전사 상태: {isTranscribing ? "진행 중" : "대기"}</div>
          <div>화자 분리 상태: {isSeparating ? "진행 중" : "대기"}</div>
          <div>AI 채점 상태: {isGrading ? "진행 중" : "대기"}</div>
          <div>저장된 세그먼트 수: {segmentBlobsRef.current.length}개</div>
        </div>

        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            textAlign: "center",
            margin: "20px 0",
            letterSpacing: 1,
          }}
        >
          {formatTime(remainingSeconds)}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginTop: 12,
          }}
        >
          <button
            onClick={startRecording}
            disabled={isTranscribing || isSeparating || isGrading}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "18px 14px",
              fontSize: 18,
              fontWeight: 700,
              background: "#2563eb",
              color: "white",
              cursor:
                isTranscribing || isSeparating || isGrading ? "not-allowed" : "pointer",
              opacity: isTranscribing || isSeparating || isGrading ? 0.6 : 1,
            }}
          >
            ON
          </button>

          <button
            onClick={stopRecording}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "18px 14px",
              fontSize: 18,
              fontWeight: 700,
              background: "#ef4444",
              color: "white",
              cursor: "pointer",
            }}
          >
            STOP
          </button>

          <button
            onClick={resetAll}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "18px 14px",
              fontSize: 18,
              fontWeight: 700,
              background: "#e5e7eb",
              color: "#111827",
              cursor: "pointer",
            }}
          >
            RESET
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <audio ref={playerRef} controls style={{ width: "100%" }} />
        </div>

        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 14,
            background: "#111827",
            color: "#f9fafb",
            minHeight: 180,
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
            fontSize: 14,
          }}
        >
          {logText}
        </div>

        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 14,
            background: "#ffffff",
            border: "1px solid #d1d5db",
            minHeight: 180,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>전사 결과</div>
          {isTranscribing ? transcript || "전사 중..." : transcript || "여기에 전사 결과가 표시됩니다."}
        </div>

        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 14,
            background: "#f9fafb",
            border: "1px solid #d1d5db",
            minHeight: 180,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>화자 분리 결과</div>
          {isSeparating
            ? "화자 분리 중..."
            : speakerError || speakerText || "여기에 의사/환자 화자 분리 결과가 표시됩니다."}
        </div>

        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 14,
            background: "#eef2ff",
            border: "1px solid #c7d2fe",
            minHeight: 220,
            whiteSpace: "pre-wrap",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>AI 채점 결과</div>

          {isGrading ? (
            "AI 채점 중..."
          ) : gradeError ? (
            gradeError
          ) : gradeResult ? (
            <>
              <div>병력청취: {gradeResult.scores.history} / 20</div>
              <div>신체진찰: {gradeResult.scores.physical_exam} / 20</div>
              <div>환자교육: {gradeResult.scores.education} / 20</div>
              <div>임상예절: {gradeResult.scores.etiquette} / 20</div>
              <div>환자의사관계: {gradeResult.scores.relationship} / 20</div>
              <div style={{ marginTop: 10, fontWeight: 800 }}>
                총점: {gradeResult.scores.total} / 100
              </div>
              <div style={{ marginTop: 14 }}>
                <b>총평</b>
                <div>{gradeResult.feedback.overall}</div>
              </div>
            </>
          ) : (
            "여기에 AI 채점 결과가 표시됩니다."
          )}
        </div>
      </div>
    </main>
  );
}