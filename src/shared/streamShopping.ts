export interface StreamObject {
  frameIndex: number;
  timestampSec?: number;
  name: string;
  description: string;
  searchQuery: string;
  box: number[];
  evidence: string;
}
export interface StreamAnswer { answer: string; items: StreamObject[] }
