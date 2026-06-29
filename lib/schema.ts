export const investigationResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "agents",
    "timeline",
    "evidenceGraph",
    "hypotheses",
    "missingData",
    "safetyWarnings",
    "finalReport",
    "xPost",
    "discordSubmission",
  ],
  properties: {
    agents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "role", "status", "summary", "keyFindings", "confidence", "severity"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          status: { type: "string", enum: ["complete"] },
          summary: { type: "string" },
          keyFindings: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "number" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestamp", "event", "source", "severity"],
        properties: {
          timestamp: { type: "string" },
          event: { type: "string" },
          source: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
        },
      },
    },
    evidenceGraph: {
      type: "object",
      additionalProperties: false,
      required: ["nodes", "edges"],
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "label", "type"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["log", "config", "note", "image", "inference", "fault"] },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "label"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      },
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rank",
          "hypothesis",
          "evidenceFor",
          "evidenceAgainst",
          "confidence",
          "recommendedTest",
          "falsificationSignal",
        ],
        properties: {
          rank: { type: "number" },
          hypothesis: { type: "string" },
          evidenceFor: {
            type: "array",
            items: { type: "string" },
          },
          evidenceAgainst: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "number" },
          recommendedTest: { type: "string" },
          falsificationSignal: { type: "string" },
        },
      },
    },
    missingData: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "reason", "priority"],
        properties: {
          item: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    safetyWarnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["warning", "severity", "requiredAction"],
        properties: {
          warning: { type: "string" },
          severity: { type: "string", enum: ["warning", "critical"] },
          requiredAction: { type: "string" },
        },
      },
    },
    finalReport: {
      type: "object",
      additionalProperties: false,
      required: [
        "executiveSummary",
        "mostLikelyRootCause",
        "rankedAlternatives",
        "evidence",
        "immediateDiagnosticSteps",
        "repairPlan",
        "safetyWarnings",
        "missingData",
        "confidenceLevel",
        "recommendedNextAction",
        "humanEscalationCriteria",
      ],
      properties: {
        executiveSummary: { type: "string" },
        mostLikelyRootCause: { type: "string" },
        rankedAlternatives: {
          type: "array",
          items: { type: "string" },
        },
        evidence: {
          type: "array",
          items: { type: "string" },
        },
        immediateDiagnosticSteps: {
          type: "array",
          items: { type: "string" },
        },
        repairPlan: {
          type: "array",
          items: { type: "string" },
        },
        safetyWarnings: {
          type: "array",
          items: { type: "string" },
        },
        missingData: {
          type: "array",
          items: { type: "string" },
        },
        confidenceLevel: { type: "string", enum: ["low", "medium", "high"] },
        recommendedNextAction: { type: "string" },
        humanEscalationCriteria: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    xPost: { type: "string" },
    discordSubmission: { type: "string" },
  },
} as const;

export const investigationResultResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "factorylens_investigation_result",
    strict: true,
    schema: investigationResultJsonSchema,
  },
} as const;

// --- Per-agent schemas for the multi-agent pipeline (orchestrator) ---

export const visionResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "factorylens_vision",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["imageProvided", "conditionSummary", "observations", "requestedEvidence"],
      properties: {
        imageProvided: { type: "boolean" },
        conditionSummary: { type: "string" },
        observations: { type: "array", items: { type: "string" } },
        requestedEvidence: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export const skepticResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "factorylens_skeptic",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["overallAssessment", "critique", "adjustments", "addedMissingData", "revisedConfidenceLevel"],
      properties: {
        overallAssessment: { type: "string" },
        critique: { type: "array", items: { type: "string" } },
        adjustments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rank", "revisedConfidence", "reason"],
            properties: {
              rank: { type: "number" },
              revisedConfidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
        addedMissingData: { type: "array", items: { type: "string" } },
        revisedConfidenceLevel: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  },
} as const;
