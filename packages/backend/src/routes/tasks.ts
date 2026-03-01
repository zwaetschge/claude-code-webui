import { Router } from "express";
import { z } from "zod";
import { getTaskManager } from "../services/tasks";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { resolveTargetUrl } from "../utils/containers";

const router = Router();

// ─── Internal endpoints (no auth, Docker-internal network) ──────────

const submitSchema = z.object({
  taskType: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  requestedBy: z.string().default("internal"),
});

router.post("/submit", (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  const tm = getTaskManager();
  const result = tm.submit(parsed.data);
  res.json({ success: true, data: result });
});

router.get("/list", (_req, res) => {
  const tm = getTaskManager();
  const tasks = tm.listTasks();
  res.json({ success: true, data: tasks });
});

router.get("/:id", (req, res) => {
  const tm = getTaskManager();
  const task = tm.getTask(req.params.id!);
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");
  res.json({ success: true, data: task });
});

router.get("/:id/poll", async (req, res) => {
  const tm = getTaskManager();
  const timeoutMs = Math.min(Number(req.query.timeout) || 30000, 60000);
  const task = await tm.pollTask(req.params.id!, timeoutMs);
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");
  res.json({ success: true, data: task });
});

const inputSchema = z.object({
  data: z.unknown(),
});

router.post("/:id/input", (req, res) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  const tm = getTaskManager();
  const ok = tm.sendInput(req.params.id!, parsed.data.data);
  if (!ok) throw new AppError("Task not accepting input", 400, "INVALID_STATE");
  res.json({ success: true });
});

router.post("/:id/cancel", (req, res) => {
  const tm = getTaskManager();
  const ok = tm.cancelTask(req.params.id!);
  if (!ok) throw new AppError("Task not found", 404, "NOT_FOUND");
  res.json({ success: true });
});

// ─── Proxy/delegate endpoints (with auth, for frontend) ─────────────

const delegateSchema = z.object({
  taskType: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  target: z.string().min(1),
});

async function proxyToTarget(
  targetUrl: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<unknown> {
  const url = `${targetUrl}/api/tasks${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new AppError(
      `Target responded with ${resp.status}: ${text}`,
      resp.status >= 500 ? 502 : resp.status,
      "PROXY_ERROR"
    );
  }
  return resp.json();
}

router.post("/delegate", requireAuth, async (req, res) => {
  const parsed = delegateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("Invalid input", 400, "VALIDATION_ERROR");
  }

  const { taskType, params, target } = parsed.data;
  const targetUrl = resolveTargetUrl(target);
  if (!targetUrl) {
    throw new AppError(`Unknown or self target: ${target}`, 400, "INVALID_TARGET");
  }

  const userId = (req as AuthenticatedRequest).userId;
  const result = await proxyToTarget(targetUrl, "/submit", "POST", {
    taskType,
    params,
    requestedBy: userId,
  });

  res.json(result);
});

router.get("/delegate/:id", requireAuth, async (req, res) => {
  const target = (req.query.target as string) || "";
  const targetUrl = resolveTargetUrl(target);
  if (!targetUrl) {
    throw new AppError(`Unknown or self target: ${target}`, 400, "INVALID_TARGET");
  }

  const result = await proxyToTarget(targetUrl, `/${req.params.id}`, "GET");
  res.json(result);
});

router.get("/delegate/:id/poll", requireAuth, async (req, res) => {
  const target = (req.query.target as string) || "";
  const targetUrl = resolveTargetUrl(target);
  if (!targetUrl) {
    throw new AppError(`Unknown or self target: ${target}`, 400, "INVALID_TARGET");
  }

  const timeout = req.query.timeout || "30000";
  const result = await proxyToTarget(
    targetUrl,
    `/${req.params.id}/poll?timeout=${timeout}`,
    "GET"
  );
  res.json(result);
});

router.post("/delegate/:id/input", requireAuth, async (req, res) => {
  const target = (req.query.target as string) || (req.body?.target as string) || "";
  const targetUrl = resolveTargetUrl(target);
  if (!targetUrl) {
    throw new AppError(`Unknown or self target: ${target}`, 400, "INVALID_TARGET");
  }

  const result = await proxyToTarget(targetUrl, `/${req.params.id}/input`, "POST", {
    data: req.body?.data,
  });
  res.json(result);
});

router.post("/delegate/:id/cancel", requireAuth, async (req, res) => {
  const target = (req.query.target as string) || (req.body?.target as string) || "";
  const targetUrl = resolveTargetUrl(target);
  if (!targetUrl) {
    throw new AppError(`Unknown or self target: ${target}`, 400, "INVALID_TARGET");
  }

  const result = await proxyToTarget(targetUrl, `/${req.params.id}/cancel`, "POST");
  res.json(result);
});

export default router;
