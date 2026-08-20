import { Kinemica } from "../src/index.js";

// Camera/OpenCV/Picamera software detects an event before this function runs.
// The SDK does not read cameras and does not control hardware.
export async function checkAssignmentAfterCameraEvent(
  kinemica: Kinemica,
  workId: string,
  taskId: string,
  workerId: string,
): Promise<void> {
  const work = await kinemica.work.retrieve(workId);
  const task = work.tasks.find((candidate) => candidate.id === taskId);
  if (!task)
    throw new Error(
      "The camera event does not reference a task in this work record.",
    );

  const decision = await kinemica.actions.authorize({
    workId: work.id,
    taskId: task.id,
    workerId,
    action: "assign_worker",
    idempotencyKey: `camera-event:${work.id}:${task.id}`,
  });

  // ALLOW means Kinemica permitted this candidate assignment. It does not dispatch a worker.
  console.log(decision.outcome, decision.ruleId, decision.reason);
}
