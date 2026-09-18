import { Router, type IRouter } from "express";
import { CreateScheduleBody } from "@workspace/api-zod";
import { generateSchedule } from "../scheduler/engine";

const router: IRouter = Router();

router.post("/schedules", (req, res) => {
  try {
    const input = CreateScheduleBody.parse(req.body);
    const result = generateSchedule(input.scenario, input.files);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate schedule";
    req.log.warn({ err: error }, "Schedule generation rejected");
    res.status(400).json({ error: message });
  }
});

export default router;