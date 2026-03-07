import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  let tempPath = "";

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "업로드된 오디오 파일이 없습니다." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const safeName = file.name?.endsWith(".webm") ? file.name : "recording.webm";
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