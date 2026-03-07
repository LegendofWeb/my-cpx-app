import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { buildGradeSystemPrompt, buildGradeUserPrompt } from "@/lib/prompts/gradePrompt";
import { TOTAL_SCORE } from "@/lib/prompts/gradeCriteria";

type DialogueTurn = {
  speaker: "의사" | "환자";
  text: string;
};

function clampScore(value: unknown, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(max, rounded));
}

function buildDialogueTextFromInput(input: {
  mergedText?: string;
  dialogue?: DialogueTurn[];
}) {
  if (typeof input.mergedText === "string" && input.mergedText.trim()) {
    return input.mergedText.trim();
  }

  if (Array.isArray(input.dialogue) && input.dialogue.length > 0) {
    return input.dialogue
      .filter(
        (turn) =>
          (turn?.speaker === "의사" || turn?.speaker === "환자") &&
          typeof turn?.text === "string" &&
          turn.text.trim().length > 0
      )
      .map((turn) => `${turn.speaker}: ${turn.text.trim()}`)
      .join("\n");
  }

  return "";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const dialogueText = buildDialogueTextFromInput(body);

    if (!dialogueText) {
      return NextResponse.json(
        {
          error:
            "채점을 위한 대화가 필요합니다. mergedText 또는 dialogue 배열을 보내주세요.",
        },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildGradeSystemPrompt(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildGradeUserPrompt(dialogueText),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cpx_grade_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              history_score: { type: "number" },
              education_score: { type: "number" },
              etiquette_score: { type: "number" },
              relationship_score: { type: "number" },

              history_strengths: { type: "string" },
              history_missed: { type: "string" },
              history_feedback: { type: "string" },

              education_strengths: { type: "string" },
              education_missed: { type: "string" },
              education_feedback: { type: "string" },

              etiquette_strengths: { type: "string" },
              etiquette_missed: { type: "string" },
              etiquette_feedback: { type: "string" },

              relationship_strengths: { type: "string" },
              relationship_missed: { type: "string" },
              relationship_feedback: { type: "string" },

              overall_feedback: { type: "string" },
            },
            required: [
              "history_score",
              "education_score",
              "etiquette_score",
              "relationship_score",

              "history_strengths",
              "history_missed",
              "history_feedback",

              "education_strengths",
              "education_missed",
              "education_feedback",

              "etiquette_strengths",
              "etiquette_missed",
              "etiquette_feedback",

              "relationship_strengths",
              "relationship_missed",
              "relationship_feedback",

              "overall_feedback",
            ],
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);

    const scores = {
      history: clampScore(parsed.history_score, 20),
      education: clampScore(parsed.education_score, 20),
      etiquette: clampScore(parsed.etiquette_score, 20),
      relationship: clampScore(parsed.relationship_score, 15),
    };

    const total =
      scores.history +
      scores.education +
      scores.etiquette +
      scores.relationship;

    const result = {
      scores: {
        ...scores,
        total,
        max_total: TOTAL_SCORE,
      },
      feedback: {
        history: {
          strengths: cleanText(parsed.history_strengths),
          missed: cleanText(parsed.history_missed),
          summary: cleanText(parsed.history_feedback),
        },
        education: {
          strengths: cleanText(parsed.education_strengths),
          missed: cleanText(parsed.education_missed),
          summary: cleanText(parsed.education_feedback),
        },
        etiquette: {
          strengths: cleanText(parsed.etiquette_strengths),
          missed: cleanText(parsed.etiquette_missed),
          summary: cleanText(parsed.etiquette_feedback),
        },
        relationship: {
          strengths: cleanText(parsed.relationship_strengths),
          missed: cleanText(parsed.relationship_missed),
          summary: cleanText(parsed.relationship_feedback),
        },
        overall: cleanText(parsed.overall_feedback),
      },
      manual_scores: {
        physical_exam: null,
      },
      mergedText: dialogueText,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Grade API error:", error);

    const message =
      error instanceof Error ? error.message : "채점 중 오류가 발생했습니다.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}