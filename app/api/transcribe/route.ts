import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

function guessExtension(file: File) {
  const name =
    typeof file.name === "string" && file.name.trim() ? file.name.trim() : "";

  if (name.includes(".")) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext) return ext;
  }

  const type = file.type.toLowerCase();

  if (type.includes("mp4") || type.includes("m4a")) return "mp4";
  if (type.includes("webm")) return "webm";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";

  return "webm";
}

export async function POST(req: NextRequest) {
  let tempPath = "";

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "업로드된 오디오 파일이 없습니다." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    if (!bytes.length) {
      return NextResponse.json(
        { error: "업로드된 오디오 파일이 비어 있습니다." },
        { status: 400 }
      );
    }

    const ext = guessExtension(file);
    const safeName = `recording-${Date.now()}.${ext}`;
    tempPath = path.join(os.tmpdir(), safeName);

    await writeFile(tempPath, bytes);

  const transcription = await client.audio.transcriptions.create({
  file: createReadStream(tempPath),
  model: "gpt-4o-transcribe",
  prompt:
    "This is a Korean CPX medical conversation between a doctor and a patient. " +
    "Please accurately transcribe Korean medical interview language, common symptoms, " +
    "doctor greetings, patient answers, and clinical expressions. " +
    "Likely terms may include 숨이 차다, 호흡곤란, 두근거림, 흉통, 두통, 일상생활, 기침, 가래, " +
    "일상생활, 감기, 고혈압, 당뇨, 천식, 약물, 피 묽게 하는 약, 직업",
    "Patient name is 김한중, age is 48",
});

    return NextResponse.json({
      text: transcription.text ?? "",
    });
  } catch (error) {
    console.error("Transcription error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "전사 처리 중 오류가 발생했습니다.";

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
  }
}