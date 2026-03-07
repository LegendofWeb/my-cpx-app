"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [micStatus, setMicStatus] = useState("대기 중");
  const [recordStatus, setRecordStatus] = useState("정지");
  const [transcript, setTranscript] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(12 * 60);
  const [logText, setLogText] = useState("로그가 여기에 표시됩니다.");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      } catch {
        // ignore
      }
    }

    return "";
  }

  function startCountdown() {
    clearTimer();

    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearTimer();
          log("12분 종료 → 자동 정지");
          stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function startRecording() {
    try {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        log("이미 녹음 중입니다.");
        return;
      }

      setTranscript("");
      setRemainingSeconds(12 * 60);

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
      const mimeType = pickMimeType();

      chunksRef.current = [];

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("Recorder error:", event);
        setRecordStatus("오류");
        log("녹음 중 오류 발생");
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });

          if (blob.size === 0) {
            setTranscript("녹음 파일이 비어 있습니다.");
            log("녹음 종료. 파일 크기: 0 KB");
            setRecordStatus("정지");
            return;
          }

          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;

          if (playerRef.current) {
            playerRef.current.src = url;
          }

          setRecordStatus("정지");
          log(`녹음 종료. 파일 크기: ${Math.round(blob.size / 1024)} KB`);

          await uploadForTranscription(blob);
        } catch (error) {
          console.error(error);
          setTranscript("녹음 종료 후 처리 중 오류가 발생했습니다.");
        }
      };

      recorder.start(1000);
      setRecordStatus("녹음 중");
      log("녹음 시작");
      startCountdown();
    } catch (error) {
      console.error(error);
      setMicStatus("실패");
      setRecordStatus("정지");
      alert("마이크 권한 또는 브라우저 설정을 확인해줘.");
    }
  }

  function stopRecording() {
    clearTimer();

    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }

  async function resetAll() {
    clearTimer();

    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }

    recorderRef.current = null;
    chunksRef.current = [];

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
    setRemainingSeconds(12 * 60);
    setLogText("로그가 여기에 표시됩니다.");
  }

  async function uploadForTranscription(blob: Blob) {
    try {
      setIsUploading(true);
      setTranscript("전사 중...");

      const formData = new FormData();
      formData.append("file", blob, "recording.webm");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "전사 실패");
      }

      setTranscript(data.text || "(텍스트 없음)");
      log("전사 완료");

      const speakerRes = await fetch("/api/speaker", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: data.text }),
});

const speakerData = await speakerRes.json();

console.log("speaker result:", speakerData);
      
    } catch (error) {
      console.error(error);
      setTranscript("전사 중 오류가 발생했습니다.");
      log("전사 실패");
    } finally {
      setIsUploading(false);
    }
  }

  useEffect(() => {
    return () => {
      clearTimer();

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
          2차 테스트 버전
        </div>

        <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>CPX 음성 전사 테스트</h1>
        <p style={{ margin: "0 0 20px", color: "#4b5563", lineHeight: 1.6 }}>
          ON을 누르면 녹음을 시작하고, STOP 후 OpenAI로 전송해 텍스트로 바꿉니다.
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
            style={{
              border: "none",
              borderRadius: 14,
              padding: "18px 14px",
              fontSize: 18,
              fontWeight: 700,
              background: "#2563eb",
              color: "white",
              cursor: "pointer",
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
            minHeight: 160,
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
          {isUploading ? "전사 중..." : transcript || "여기에 전사 결과가 표시됩니다."}
        </div>
      </div>
    </main>
  );
}