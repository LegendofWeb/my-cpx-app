import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { buildGradeSystemPrompt, buildGradeUserPrompt } from "@/lib/prompts/gradePrompt";

type DialogueTurn = {
  speaker: "의사" | "환자";
  text: string;
};

function clampScore(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(20, rounded));
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
              physical_exam_score: { type: "number" },
              education_score: { type: "number" },
              etiquette_score: { type: "number" },
              relationship_score: { type: "number" },

              history_feedback: { type: "string" },
              physical_exam_feedback: { type: "string" },
              education_feedback: { type: "string" },
              etiquette_feedback: { type: "string" },
              relationship_feedback: { type: "string" },

              overall_feedback: { type: "string" },
            },
            required: [
              "history_score",
              "physical_exam_score",
              "education_score",
              "etiquette_score",
              "relationship_score",
              "history_feedback",
              "physical_exam_feedback",
              "education_feedback",
              "etiquette_feedback",
              "relationship_feedback",
              "overall_feedback",
            ],
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);

    const scores = {
      history: clampScore(parsed.history_score),
      physical_exam: clampScore(parsed.physical_exam_score),
      education: clampScore(parsed.education_score),
      etiquette: clampScore(parsed.etiquette_score),
      relationship: clampScore(parsed.relationship_score),
    };

    const total =
      scores.history +
      scores.physical_exam +
      scores.education +
      scores.etiquette +
      scores.relationship;

    const result = {
      scores: {
        ...scores,
        total,
      },
      feedback: {
        history:
          typeof parsed.history_feedback === "string"
            ? parsed.history_feedback.trim()
            : "",
        physical_exam:
          typeof parsed.physical_exam_feedback === "string"
            ? parsed.physical_exam_feedback.trim()
            : "",
        education:
          typeof parsed.education_feedback === "string"
            ? parsed.education_feedback.trim()
            : "",
        etiquette:
          typeof parsed.etiquette_feedback === "string"
            ? parsed.etiquette_feedback.trim()
            : "",
        relationship:
          typeof parsed.relationship_feedback === "string"
            ? parsed.relationship_feedback.trim()
            : "",
        overall:
          typeof parsed.overall_feedback === "string"
            ? parsed.overall_feedback.trim()
            : "",
      },
      mergedText: dialogueText,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Grade API error:", error);
    return NextResponse.json(
      { error: "채점 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}