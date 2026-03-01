import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/services/api";
import type { DelegatedTaskInfo } from "@claude-code-webui/shared";

interface TaskResponse {
  success: boolean;
  data: DelegatedTaskInfo;
}

interface SubmitResponse {
  success: boolean;
  data: { taskId: string; status: string; createdAt: string };
}

interface UseTaskDelegationOptions {
  /** Poll interval in ms (default: 2000) */
  pollInterval?: number;
  /** Auto-poll after submit (default: true) */
  autoPoll?: boolean;
}

interface UseTaskDelegationReturn {
  taskId: string | null;
  taskInfo: DelegatedTaskInfo | null;
  isLoading: boolean;
  error: string | null;
  submit: (target: string, taskType: string, params?: Record<string, unknown>) => Promise<string | null>;
  sendInput: (data: unknown) => Promise<boolean>;
  cancel: () => Promise<boolean>;
  reset: () => void;
}

export function useTaskDelegation(
  options: UseTaskDelegationOptions = {}
): UseTaskDelegationReturn {
  const { pollInterval = 2000, autoPoll = true } = options;

  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskInfo, setTaskInfo] = useState<DelegatedTaskInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const isTerminal = (status?: string) =>
    status === "completed" || status === "error" || status === "cancelled";

  const pollStatus = useCallback(
    async (id: string, target: string) => {
      try {
        const resp = await api.get<TaskResponse>(
          `/api/tasks/delegate/${id}?target=${encodeURIComponent(target)}`
        );
        const info = resp.data.data;
        setTaskInfo(info);

        if (info.status === "error") {
          setError(info.error || "Task failed");
        }

        if (isTerminal(info.status)) {
          stopPolling();
          setIsLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Polling failed");
        stopPolling();
        setIsLoading(false);
      }
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (id: string, target: string) => {
      stopPolling();
      // Immediate first poll
      pollStatus(id, target);
      pollTimerRef.current = setInterval(() => pollStatus(id, target), pollInterval);
    },
    [stopPolling, pollStatus, pollInterval]
  );

  const submit = useCallback(
    async (
      target: string,
      taskType: string,
      params: Record<string, unknown> = {}
    ): Promise<string | null> => {
      setIsLoading(true);
      setError(null);
      setTaskInfo(null);
      stopPolling();

      try {
        const resp = await api.post<SubmitResponse>("/api/tasks/delegate", {
          taskType,
          params,
          target,
        });

        const id = resp.data.data.taskId;
        setTaskId(id);
        targetRef.current = target;

        if (autoPoll) {
          startPolling(id, target);
        }

        return id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit task";
        setError(msg);
        setIsLoading(false);
        return null;
      }
    },
    [stopPolling, startPolling, autoPoll]
  );

  const sendInput = useCallback(
    async (data: unknown): Promise<boolean> => {
      if (!taskId || !targetRef.current) return false;

      try {
        await api.post(
          `/api/tasks/delegate/${taskId}/input?target=${encodeURIComponent(targetRef.current)}`,
          { data }
        );
        // Resume polling to get updated status
        if (!pollTimerRef.current && targetRef.current) {
          startPolling(taskId, targetRef.current);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send input");
        return false;
      }
    },
    [taskId, startPolling]
  );

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!taskId || !targetRef.current) return false;

    try {
      await api.post(
        `/api/tasks/delegate/${taskId}/cancel?target=${encodeURIComponent(targetRef.current)}`
      );
      stopPolling();
      setIsLoading(false);
      return true;
    } catch {
      return false;
    }
  }, [taskId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setTaskId(null);
    setTaskInfo(null);
    setIsLoading(false);
    setError(null);
    targetRef.current = null;
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    taskId,
    taskInfo,
    isLoading,
    error,
    submit,
    sendInput,
    cancel,
    reset,
  };
}
