export interface RequestMessage {
  role?: string;
  content?: string;
  images?: string[] | string;
}

export interface GenerateBody {
  prompt?: unknown;
  text?: unknown;
  system?: unknown;
  images?: unknown;
  messages?: RequestMessage[] | string | unknown;
  options?: unknown;
  think?: unknown;
}

export interface GenerateResponse {
  text: string;
  model: string;
  doneReason?: string;
  stats: {
    totalDurationNs?: number;
    loadDurationNs?: number;
    promptEvalCount?: number;
    evalCount?: number;
  };
}
