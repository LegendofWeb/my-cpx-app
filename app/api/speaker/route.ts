import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

const SPEAKER_SYSTEM_PROMPT = `너는 의과대학 CPX 대화에서 화자를 구분하는 도우미다.
입력은 의사와 환자의 발화가 섞여 있는 한국어 전사문이다.
너의 목표는 각 발화를 순서대로 분리하고, 각 발화의 화자를 반드시 "의사" 또는 "환자" 중 하나로 판정하는 것이다.

판정 원칙:
1. 문진 질문, 진찰 제안, 검사 설명, 치료 계획 설명, 교육, 정리 발언은 보통 "의사"다.
2. 증상 설명, 병력 답변, 감정 표현, 걱정, 질문에 대한 응답은 보통 "환자"다.
3. "네", "아", "음"처럼 짧은 말도 앞뒤 문맥을 보고 반드시 하나로 분류한다.
4. 한 줄 안에 두 사람의 발화가 섞여 있으면 자연스럽게 분리한다.
5. 확실하지 않아도 가장 가능성이 높은 쪽으로 추정한다.
6. 화자명은 반드시 "의사" 또는 "환자"만 사용한다. 다른 화자명은 절대 쓰지 않는다.
7. 불필요한 설명 없이 JSON만 출력한다.

반환 형식:
{
  "dialogue": [
    { "speaker": "의사", "text": "..." },
    { "speaker": "환자", "text": "..." }
  ]
}`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "화자 분리를 위한 text가 필요합니다." },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SPEAKER_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `다음 CPX 전사문을 화자 분리해줘.\n\n전사문:\n${text}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "speaker_separation",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              dialogue: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    speaker: {
                      type: "string",
                      enum: ["의사", "환자"],
                    },
                    text: {
                      type: "string",
                    },
                  },
                  required: ["speaker", "text"],
                },
              },
            },
            required: ["dialogue"],
          },
          strict: true,
        },
      },
    });

    const content = response.output_text;
    const parsed = JSON.parse(content);

    const cleanedDialogue = Array.isArray(parsed?.dialogue)
      ? parsed.dialogue
          .filter(
            (item: { speaker?: string; text?: string }) =>
              (item?.speaker === "의사" || item?.speaker === "환자") &&
              typeof item?.text === "string" &&
              item.text.trim().length > 0
          )
          .map((item: { speaker: "의사" | "환자"; text: string }) => ({
            speaker: item.speaker,
            text: item.text.trim(),
          }))
      : [];

    const mergedText = cleanedDialogue
      .map((turn: { speaker: "의사" | "환자"; text: string }) => `${turn.speaker}: ${turn.text}`)
      .join("\n");

    return NextResponse.json({
      dialogue: cleanedDialogue,
      mergedText,
    });
  } catch (error) {
    console.error("Speaker separation error:", error);
    return NextResponse.json(
      { error: "화자 분리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}