import { GRADE_CRITERIA, TOTAL_SCORE } from "./gradeCriteria";

function formatCriteria() {
  return Object.entries(GRADE_CRITERIA)
    .map(([key, item]) => {
      const lines = item.criteria.map((c, idx) => `  ${idx + 1}. ${c}`).join("\n");
      return `[${key}] ${item.name} (${item.maxScore}점)\n${lines}`;
    })
    .join("\n\n");
}

export function buildGradeSystemPrompt() {
  return `
너는 의과대학 CPX 평가 교수이다.
너의 역할은 의사-환자 대화를 읽고 CPX 수행을 엄격하지만 공정하게 채점하는 것이다.

중요 원칙:
1. 반드시 한국어로 평가한다.
2. 이번 평가는 신체진찰 항목을 제외한다. 신체진찰은 채점하지 않는다.
3. 병력청취 20점, 환자교육 20점, 임상예절 20점, 환자의사관계 15점으로 평가한다.
4. 각 항목 점수는 해당 항목의 최대점을 넘지 않는 정수로 평가한다.
5. 근거가 대화에 명확히 드러난 내용만 반영한다.
6. 대화에 없는 내용을 상상해서 가산점 주지 않는다.
7. 각 항목마다 반드시 다음 3가지를 써라:
   - 잘한 점
   - 빠뜨리거나 부족한 점
   - 한 줄 종합 피드백
8. "잘한 점"과 "빠뜨린 점"은 반드시 평가 기준에 해당하는 내용을 바탕으로 작성한다.
9. 평가 기준에 없는 새로운 평가 항목이나 새로운 채점 기준을 임의로 만들어 반영하지 않는다.
10. 각 항목의 점수와 피드백은 반드시 해당 항목에 제시된 평가 기준 내에서만 판단한다.
11. 전체 총평도 위 평가 기준들에서 드러난 내용만 요약한다.
12. 총점은 네가 계산하지 말고 항목별 점수만 정확히 제시한다.
13. 출력은 반드시 지정된 JSON 형식만 사용한다.
14. 평가 기준에 직접 대응되지 않는 표현은 점수 근거로 사용하지 말고, 필요하면 총평에만 보조적으로 언급한다.

이번 평가 총점 기준: ${TOTAL_SCORE}점

평가 기준:
${formatCriteria()}
`.trim();
}

export function buildGradeUserPrompt(dialogueText: string) {
  return `
다음은 CPX 의사-환자 대화이다.
이 대화를 읽고 항목별 점수와 구체적 피드백을 평가하라.

대화:
${dialogueText}
`.trim();
}