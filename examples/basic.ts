import {
  Kinemica,
  KinemicaApiError,
  type AuthorizationDecision,
} from "../src/index.js";

const apiKey = process.env.KINEMICA_API_KEY;
const baseUrl = process.env.KINEMICA_API_BASE_URL;

if (!apiKey || !baseUrl) {
  throw new Error("KINEMICA_API_KEY and KINEMICA_API_BASE_URL are required.");
}

const kinemica = new Kinemica({ apiKey, baseUrl });

try {
  const work = await kinemica.work.retrieve("job_123");
  const decision: AuthorizationDecision = await kinemica.actions.authorize({
    workId: work.id,
    taskId: "task_456",
    workerId: "worker_789",
    action: "assign_worker",
    idempotencyKey: "assignment-check-001",
  });

  switch (decision.outcome) {
    case "ALLOW":
      console.log("Assignment permitted.");
      break;
    case "BLOCK":
      console.log(`Assignment blocked: ${decision.reason}`);
      break;
    case "REQUIRE_APPROVAL":
      console.log(`Supervisor approval required: ${decision.reason}`);
      break;
  }
} catch (error) {
  if (error instanceof KinemicaApiError) {
    console.error(error.code, error.requestId);
  }
  throw error;
}
