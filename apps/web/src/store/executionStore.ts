import { create } from 'zustand';

export type ExecutionStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface ExecutionState {
  status: ExecutionStatus;
  selectedRunId: string | null;
  setStatus: (status: ExecutionStatus) => void;
  setSelectedRunId: (runId: string | null) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  status: 'idle',
  selectedRunId: null,
  setStatus: (status) => set({ status }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
}));
