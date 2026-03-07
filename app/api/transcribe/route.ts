import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

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

const originalName =
  typeof file.name === "string" && file.name.trim()
    ? file.name.trim()
    : "recording.webm";

const safeName = originalName.replace(/[^\w.\-]/g, "_");

tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeName}`);

    await writeFile(tempPath, bytes);

    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(tempPath),
      model: "gpt-4o-mini-transcribe",
    });

    return NextResponse.json({
      text: transcription.text ?? "",
    });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: "전사 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
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